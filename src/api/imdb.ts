import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";

import { PersistedLruMap } from "../services/persistedLruMap";

// The upstream GitHub dataset has rotated its schema over time. Older revisions
// used string fields with "Movie Name"/"Movie Link"; the current one uses
// numeric Rank/"IMDb Rating" with "name"/"link". Accept both shapes so a future
// rotation doesn't silently drop us back to the bundled fallback list.
type ImdbTop250MovieEntry = {
  Rank?: string | number;
  "Movie Name"?: string;
  name?: string;
  "IMDb Rating"?: string | number;
  "Movie Link"?: string;
  link?: string;
};

type ImdbTop250ShowEntry = {
  Rank?: string | number;
  "Show Name"?: string;
  name?: string;
  "IMDb Rating"?: string | number;
  "Show Link"?: string;
  link?: string;
};

export type ImdbTop250Item = {
  rank: number;
  title: string;
  imdbId: string;
  imdbRating: number;
};

type ImdbApiTitleResponse = {
  id: string;
  rating?: {
    aggregateRating: number;
    voteCount: number;
  };
};

type PersistedTop250Cache = {
  savedAt: number;
  items: ImdbTop250Item[];
};

type Top250Kind = "movies" | "shows";

const OFFICIAL_IMDB_TOP250_MOVIES_URL = "https://www.imdb.com/chart/top/?hl=en-US";
const OFFICIAL_IMDB_TOP250_SHOWS_URL = "https://www.imdb.com/chart/toptv/?hl=en-US";
const OFFICIAL_IMDB_POPULAR_MOVIES_URL = "https://www.imdb.com/chart/moviemeter/?hl=en-US";

const GITHUB_TOP250_MOVIES_URL =
  "https://raw.githubusercontent.com/crazyuploader/IMDb_Top_50/main/data/top250/movies.json";

const GITHUB_TOP250_SHOWS_URL =
  "https://raw.githubusercontent.com/crazyuploader/IMDb_Top_50/main/data/top250/shows.json";

const IMDBAPI_BASE_URL = "https://api.imdbapi.dev";

const TOP250_FETCH_TIMEOUT = 12_000;
const GITHUB_FETCH_TIMEOUT = 15_000;
const IMDBAPI_FETCH_TIMEOUT = 8_000;
const MIN_ACCEPTABLE_OFFICIAL_ITEMS = 20;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PERSISTED_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PERSISTED_TOP250_MOVIES_KEY = "@streambox/imdb-top250-movies-v2";
const PERSISTED_TOP250_SHOWS_KEY = "@streambox/imdb-top250-shows-v2";
const PERSISTED_POPULAR_MOVIES_KEY = "@streambox/imdb-popular-movies-v1";

const IMDB_CHART_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; StreamBox) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
};

let cachedTop250Movies: ImdbTop250Item[] | null = null;
let cachedTop250Shows: ImdbTop250Item[] | null = null;
let cachedPopularMovies: ImdbTop250Item[] | null = null;
let moviesLastFetch = 0;
let showsLastFetch = 0;
let popularMoviesLastFetch = 0;

// Bounded: individual IMDb ratings accumulate as the user browses. Persisted so
// a cold start doesn't refetch the same ratings; ratings drift slowly, so a 24h
// snapshot TTL keeps them honest. has()/get() negative-caching is preserved.
const imdbRatingCache = new PersistedLruMap<number | null>({
  storageKey: "@streambox/api-cache-imdb-ratings-v1",
  maxEntries: 2000,
  ttlMs: 24 * 60 * 60 * 1000,
});
// Bounded by concurrency: each entry is removed in its own finally block.
const inFlightImdbRatingRequests = new Map<string, Promise<number | null>>();

function extractImdbId(link: string): string | null {
  const match = link.match(/(tt\d+)/);
  return match?.[1] ?? null;
}

function toRank(value: unknown, fallbackIndex: number): number {
  const rank = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(rank) && rank > 0 ? rank : fallbackIndex + 1;
}

function parseMovieEntry(entry: ImdbTop250MovieEntry, index: number): ImdbTop250Item | null {
  const imdbId = extractImdbId(entry["Movie Link"] ?? entry.link ?? "");
  const title = entry["Movie Name"] ?? entry.name;
  if (!imdbId || !title) return null;

  return {
    rank: toRank(entry.Rank, index),
    title: decodeHtmlEntities(title),
    imdbId,
    imdbRating: toRating(entry["IMDb Rating"]),
  };
}

function parseShowEntry(entry: ImdbTop250ShowEntry, index: number): ImdbTop250Item | null {
  const imdbId = extractImdbId(entry["Show Link"] ?? entry.link ?? "");
  const title = entry["Show Name"] ?? entry.name;
  if (!imdbId || !title) return null;

  return {
    rank: toRank(entry.Rank, index),
    title: decodeHtmlEntities(title),
    imdbId,
    imdbRating: toRating(entry["IMDb Rating"]),
  };
}

function decodeHtmlEntities(text: string): string {
  return String(text ?? "")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function stripHtml(text: string): string {
  return decodeHtmlEntities(text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

function unescapeJsonString(text: string): string {
  try {
    return JSON.parse(`"${text}"`);
  } catch {
    return text.replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
}

function toRating(value: unknown): number {
  const rating = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(rating) ? rating : 0;
}

function normalizeTop250Items(items: ImdbTop250Item[]): ImdbTop250Item[] {
  const seen = new Set<string>();
  const normalized: ImdbTop250Item[] = [];

  items
    .filter((item) => item.imdbId.startsWith("tt") && item.title.length > 0)
    .sort((a, b) => a.rank - b.rank)
    .forEach((item) => {
      if (seen.has(item.imdbId)) return;
      seen.add(item.imdbId);
      normalized.push({
        ...item,
        rank: normalized.length + 1,
      });
    });

  return normalized.slice(0, 250);
}

function readNestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;

  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : null;
}

function readNestedNumber(value: unknown, path: string[]): number | null {
  let current: unknown = value;

  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  if (typeof current === "number") return current;
  if (typeof current === "string") {
    const parsed = parseFloat(current);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function collectJsonChartItems(value: unknown, items: ImdbTop250Item[]): void {
  if (Array.isArray(value)) {
    value.forEach((child) => collectJsonChartItems(child, items));
    return;
  }

  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : typeof record.tconst === "string" ? record.tconst : null;
  const imdbId = id?.match(/^tt\d+$/) ? id : null;
  const title =
    readNestedString(record, ["titleText", "text"]) ??
    readNestedString(record, ["originalTitleText", "text"]) ??
    (typeof record.name === "string" ? record.name : null);

  if (imdbId && title) {
    const rank =
      readNestedNumber(record, ["chartPosition", "currentRank"]) ??
      readNestedNumber(record, ["currentRank"]) ??
      readNestedNumber(record, ["rank"]) ??
      readNestedNumber(record, ["position"]);

    if (!rank) {
      Object.values(record).forEach((child) => collectJsonChartItems(child, items));
      return;
    }

    const imdbRating =
      readNestedNumber(record, ["ratingsSummary", "aggregateRating"]) ??
      readNestedNumber(record, ["aggregateRating", "ratingValue"]) ??
      readNestedNumber(record, ["rating", "aggregateRating"]) ??
      0;

    items.push({
      rank,
      title: decodeHtmlEntities(title),
      imdbId,
      imdbRating,
    });
  }

  Object.values(record).forEach((child) => collectJsonChartItems(child, items));
}

function parseJsonLdChart(html: string): ImdbTop250Item[] {
  const items: ImdbTop250Item[] = [];
  const scriptRegex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptRegex)) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1]));
      collectJsonChartItems(parsed, items);

      const itemLists: unknown[] = [];
      collectItemListElements(parsed, itemLists);
      itemLists.forEach((entry, index) => {
        if (!entry || typeof entry !== "object") return;

        const record = entry as Record<string, unknown>;
        const rawItem =
          record.item && typeof record.item === "object"
            ? (record.item as Record<string, unknown>)
            : record;
        const rawUrl = typeof rawItem.url === "string" ? rawItem.url : "";
        const imdbId = extractImdbId(rawUrl);
        const title =
          typeof rawItem.name === "string"
            ? rawItem.name
            : typeof record.name === "string"
              ? record.name
              : "";

        if (!imdbId || !title) return;

        items.push({
          rank: toRating(record.position) || index + 1,
          title: decodeHtmlEntities(title),
          imdbId,
          imdbRating: readNestedNumber(rawItem, ["aggregateRating", "ratingValue"]) ?? 0,
        });
      });
    } catch {
      // IMDb changes this script often. Other parsers below are the safety net.
    }
  }

  return normalizeTop250Items(items);
}

function collectItemListElements(value: unknown, items: unknown[]): void {
  if (Array.isArray(value)) {
    value.forEach((child) => collectItemListElements(child, items));
    return;
  }

  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.itemListElement)) {
    items.push(...record.itemListElement);
  }

  Object.values(record).forEach((child) => collectItemListElements(child, items));
}

function parseEmbeddedJsonChart(html: string): ImdbTop250Item[] {
  const decoded = decodeHtmlEntities(html);
  const items: ImdbTop250Item[] = [];
  const titleNodeRegex =
    /"id":"(tt\d+)".{0,1400}?"titleText":\{"text":"((?:\\"|[^"])*)"/gs;

  for (const match of decoded.matchAll(titleNodeRegex)) {
    const chunk = decoded.slice(match.index ?? 0, (match.index ?? 0) + 2_200);
    const rankMatch =
      chunk.match(/"currentRank":(\d+)/) ??
      chunk.match(/"rank":(\d+)/) ??
      chunk.match(/"position":(\d+)/);

    if (!rankMatch) continue;

    const ratingMatch =
      chunk.match(/"aggregateRating":([0-9.]+)/) ?? chunk.match(/"ratingValue":([0-9.]+)/);

    items.push({
      rank: parseInt(rankMatch[1], 10),
      title: decodeHtmlEntities(unescapeJsonString(match[2])),
      imdbId: match[1],
      imdbRating: ratingMatch ? parseFloat(ratingMatch[1]) : 0,
    });
  }

  return normalizeTop250Items(items);
}

function parseAnchorChart(html: string): ImdbTop250Item[] {
  const decoded = decodeHtmlEntities(html);
  const items: ImdbTop250Item[] = [];
  const anchorRegex =
    /<a[^>]+href=["'][^"']*\/title\/(tt\d+)\/[^"']*["'][^>]*>([\s\S]*?)<\/a>[\s\S]{0,700}?([0-9]\.[0-9])/gi;

  for (const match of decoded.matchAll(anchorRegex)) {
    const title = stripHtml(match[2]);
    if (!title || title.length > 120) continue;

    const prefix = decoded.slice(Math.max(0, (match.index ?? 0) - 500), match.index ?? 0);
    const rankMatch = prefix.match(/(?:^|[^\d])(\d{1,3})\.\s*$/) ?? prefix.match(/#(\d{1,3})/);

    items.push({
      rank: rankMatch ? parseInt(rankMatch[1], 10) : items.length + 1,
      title,
      imdbId: match[1],
      imdbRating: parseFloat(match[3]) || 0,
    });
  }

  return normalizeTop250Items(items);
}

function parseOfficialImdbChartHtml(html: string): ImdbTop250Item[] {
  const jsonLdItems = parseJsonLdChart(html);
  if (jsonLdItems.length >= MIN_ACCEPTABLE_OFFICIAL_ITEMS) return jsonLdItems;

  const embeddedJsonItems = parseEmbeddedJsonChart(html);
  if (embeddedJsonItems.length >= MIN_ACCEPTABLE_OFFICIAL_ITEMS) return embeddedJsonItems;

  return parseAnchorChart(html);
}

async function fetchOfficialTop250(url: string): Promise<ImdbTop250Item[]> {
  const { data } = await axios.get<string>(url, {
    headers: IMDB_CHART_HEADERS,
    timeout: TOP250_FETCH_TIMEOUT,
    transformResponse: [(value) => String(value ?? "")],
  });

  return parseOfficialImdbChartHtml(data);
}

async function fetchOfficialPopularMovies(): Promise<ImdbTop250Item[]> {
  const { data } = await axios.get<string>(OFFICIAL_IMDB_POPULAR_MOVIES_URL, {
    headers: IMDB_CHART_HEADERS,
    timeout: TOP250_FETCH_TIMEOUT,
    transformResponse: [(value) => String(value ?? "")],
  });

  return parseOfficialImdbChartHtml(data);
}

async function fetchGithubTop250Movies(): Promise<ImdbTop250Item[]> {
  const { data } = await axios.get<ImdbTop250MovieEntry[]>(GITHUB_TOP250_MOVIES_URL, {
    timeout: GITHUB_FETCH_TIMEOUT,
  });

  return normalizeTop250Items(
    data.map(parseMovieEntry).filter((item): item is ImdbTop250Item => item !== null),
  );
}

async function fetchGithubTop250Shows(): Promise<ImdbTop250Item[]> {
  const { data } = await axios.get<ImdbTop250ShowEntry[]>(GITHUB_TOP250_SHOWS_URL, {
    timeout: GITHUB_FETCH_TIMEOUT,
  });

  return normalizeTop250Items(
    data.map(parseShowEntry).filter((item): item is ImdbTop250Item => item !== null),
  );
}

async function readPersistedTop250(key: string): Promise<ImdbTop250Item[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PersistedTop250Cache;
    if (!Array.isArray(parsed.items) || Date.now() - parsed.savedAt > PERSISTED_CACHE_TTL_MS) {
      return null;
    }

    const items = normalizeTop250Items(parsed.items);
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

function persistTop250(key: string, items: ImdbTop250Item[]): void {
  const payload: PersistedTop250Cache = {
    savedAt: Date.now(),
    items: normalizeTop250Items(items),
  };

  void AsyncStorage.setItem(key, JSON.stringify(payload)).catch(() => undefined);
}

function setMemoryCache(kind: Top250Kind, items: ImdbTop250Item[]): void {
  const normalized = normalizeTop250Items(items);
  if (kind === "movies") {
    cachedTop250Movies = normalized;
    moviesLastFetch = Date.now();
    return;
  }

  cachedTop250Shows = normalized;
  showsLastFetch = Date.now();
}

function getMemoryCache(kind: Top250Kind): { items: ImdbTop250Item[] | null; lastFetch: number } {
  return kind === "movies"
    ? { items: cachedTop250Movies, lastFetch: moviesLastFetch }
    : { items: cachedTop250Shows, lastFetch: showsLastFetch };
}

async function refreshTop250(kind: Top250Kind): Promise<ImdbTop250Item[]> {
  const officialUrl = kind === "movies" ? OFFICIAL_IMDB_TOP250_MOVIES_URL : OFFICIAL_IMDB_TOP250_SHOWS_URL;
  const persistedKey = kind === "movies" ? PERSISTED_TOP250_MOVIES_KEY : PERSISTED_TOP250_SHOWS_KEY;
  const githubFetch = kind === "movies" ? fetchGithubTop250Movies : fetchGithubTop250Shows;
  const fallback = kind === "movies" ? FALLBACK_TOP250_MOVIES : FALLBACK_TOP250_SHOWS;

  try {
    const officialItems = await fetchOfficialTop250(officialUrl);
    if (officialItems.length >= MIN_ACCEPTABLE_OFFICIAL_ITEMS) {
      setMemoryCache(kind, officialItems);
      persistTop250(persistedKey, officialItems);
      return officialItems;
    }
  } catch {
    // Fall through to the secondary provider and bundled fallback.
  }

  try {
    const githubItems = await githubFetch();
    if (githubItems.length > 0) {
      setMemoryCache(kind, githubItems);
      persistTop250(persistedKey, githubItems);
      return githubItems;
    }
  } catch {
    // Bundled fallback below keeps the production screen usable.
  }

  setMemoryCache(kind, fallback);
  return fallback;
}

async function getTop250(kind: Top250Kind): Promise<ImdbTop250Item[]> {
  const now = Date.now();
  const { items: memoryItems, lastFetch } = getMemoryCache(kind);
  if (memoryItems && now - lastFetch < CACHE_TTL_MS) {
    return memoryItems;
  }

  const persistedKey = kind === "movies" ? PERSISTED_TOP250_MOVIES_KEY : PERSISTED_TOP250_SHOWS_KEY;
  const persistedItems = await readPersistedTop250(persistedKey);
  if (persistedItems) {
    setMemoryCache(kind, persistedItems);
    void refreshTop250(kind).catch(() => undefined);
    return persistedItems;
  }

  return refreshTop250(kind);
}

async function refreshPopularMovies(): Promise<ImdbTop250Item[]> {
  try {
    const officialItems = await fetchOfficialPopularMovies();
    if (officialItems.length >= MIN_ACCEPTABLE_OFFICIAL_ITEMS) {
      cachedPopularMovies = officialItems;
      popularMoviesLastFetch = Date.now();
      persistTop250(PERSISTED_POPULAR_MOVIES_KEY, officialItems);
      return officialItems;
    }
  } catch {
    // TMDB popular is the fallback at the caller so the hero never goes empty.
  }

  return [];
}

export async function getImdbPopularMovies(): Promise<ImdbTop250Item[]> {
  const now = Date.now();
  if (cachedPopularMovies && now - popularMoviesLastFetch < CACHE_TTL_MS) {
    return cachedPopularMovies;
  }

  const persistedItems = await readPersistedTop250(PERSISTED_POPULAR_MOVIES_KEY);
  if (persistedItems) {
    cachedPopularMovies = persistedItems;
    popularMoviesLastFetch = Date.now();
    void refreshPopularMovies().catch(() => undefined);
    return persistedItems;
  }

  return refreshPopularMovies();
}

export function getImdbTop250Movies(): Promise<ImdbTop250Item[]> {
  return getTop250("movies");
}

export function getImdbTop250Shows(): Promise<ImdbTop250Item[]> {
  return getTop250("shows");
}

export async function getImdbRating(imdbId: string): Promise<number | null> {
  if (!imdbId || !imdbId.startsWith("tt")) return null;

  if (imdbRatingCache.has(imdbId)) {
    return imdbRatingCache.get(imdbId) ?? null;
  }

  const existing = inFlightImdbRatingRequests.get(imdbId);
  if (existing) return existing;

  const request = (async (): Promise<number | null> => {
    try {
      const { data } = await axios.get<ImdbApiTitleResponse>(
        `${IMDBAPI_BASE_URL}/titles/${imdbId}`,
        { timeout: IMDBAPI_FETCH_TIMEOUT },
      );

      const rating = data.rating?.aggregateRating ?? null;
      imdbRatingCache.set(imdbId, rating);
      return rating;
    } catch {
      imdbRatingCache.set(imdbId, null);
      return null;
    } finally {
      inFlightImdbRatingRequests.delete(imdbId);
    }
  })();

  inFlightImdbRatingRequests.set(imdbId, request);
  return request;
}

export function seedImdbRatingCache(imdbId: string, rating: number): void {
  imdbRatingCache.set(imdbId, rating);
}

function fromCompactFallback(rows: string[]): ImdbTop250Item[] {
  return rows.map((row, index) => {
    const [imdbId, title, imdbRating] = row.split("|");
    return {
      rank: index + 1,
      title,
      imdbId,
      imdbRating: parseFloat(imdbRating) || 0,
    };
  });
}

const FALLBACK_TOP250_MOVIES = fromCompactFallback([
  "tt0111161|The Shawshank Redemption|9.3",
  "tt0068646|The Godfather|9.2",
  "tt0468569|The Dark Knight|9.0",
  "tt0071562|The Godfather Part II|9.0",
  "tt0050083|12 Angry Men|9.0",
  "tt0108052|Schindler's List|9.0",
  "tt0167260|The Lord of the Rings: The Return of the King|9.0",
  "tt0110912|Pulp Fiction|8.9",
  "tt0120737|The Lord of the Rings: The Fellowship of the Ring|8.9",
  "tt0060196|The Good, the Bad and the Ugly|8.8",
  "tt0109830|Forrest Gump|8.8",
  "tt0167261|The Lord of the Rings: The Two Towers|8.8",
  "tt0137523|Fight Club|8.8",
  "tt1375666|Inception|8.8",
  "tt0080684|Star Wars: Episode V - The Empire Strikes Back|8.7",
  "tt0133093|The Matrix|8.7",
  "tt0099685|Goodfellas|8.7",
  "tt0816692|Interstellar|8.7",
  "tt0073486|One Flew Over the Cuckoo's Nest|8.7",
  "tt0114369|Se7en|8.6",
  "tt0038650|It's a Wonderful Life|8.6",
  "tt0102926|The Silence of the Lambs|8.6",
  "tt0047478|Seven Samurai|8.6",
  "tt0120815|Saving Private Ryan|8.6",
  "tt0120689|The Green Mile|8.6",
  "tt0317248|City of God|8.6",
  "tt0118799|Life Is Beautiful|8.6",
  "tt0103064|Terminator 2: Judgment Day|8.6",
  "tt0076759|Star Wars: Episode IV - A New Hope|8.6",
  "tt0088763|Back to the Future|8.5",
  "tt0245429|Spirited Away|8.6",
  "tt0253474|The Pianist|8.5",
  "tt0172495|Gladiator|8.5",
  "tt6751668|Parasite|8.5",
  "tt0095327|Grave of the Fireflies|8.5",
  "tt0054215|Psycho|8.5",
  "tt0110357|The Lion King|8.5",
  "tt0056058|Harakiri|8.6",
  "tt0407887|The Departed|8.5",
  "tt2582802|Whiplash|8.5",
  "tt0482571|The Prestige|8.5",
  "tt0120586|American History X|8.5",
  "tt0110413|Leon: The Professional|8.5",
  "tt9362722|Spider-Man: Across the Spider-Verse|8.5",
  "tt0095765|Cinema Paradiso|8.5",
  "tt0034583|Casablanca|8.5",
  "tt1675434|The Intouchables|8.5",
  "tt0114814|The Usual Suspects|8.5",
  "tt0078748|Alien|8.5",
  "tt1853728|Django Unchained|8.5",
  "tt0027977|Modern Times|8.5",
  "tt0047396|Rear Window|8.5",
  "tt0064116|Once Upon a Time in the West|8.5",
  "tt0021749|City Lights|8.5",
  "tt0078788|Apocalypse Now|8.4",
  "tt0910970|WALL-E|8.4",
  "tt0209144|Memento|8.4",
  "tt15239678|Dune: Part Two|8.5",
  "tt0082971|Raiders of the Lost Ark|8.4",
  "tt4154756|Avengers: Infinity War|8.4",
  "tt0405094|The Lives of Others|8.4",
  "tt4633694|Spider-Man: Into the Spider-Verse|8.4",
  "tt0043014|Sunset Boulevard|8.4",
  "tt0051201|Witness for the Prosecution|8.4",
  "tt0050825|Paths of Glory|8.4",
  "tt0081505|The Shining|8.4",
  "tt0032553|The Great Dictator|8.4",
  "tt0361748|Inglourious Basterds|8.4",
  "tt23849204|12th Fail|8.8",
  "tt0090605|Aliens|8.4",
  "tt0057565|High and Low|8.4",
  "tt0119217|Good Will Hunting|8.3",
  "tt1345836|The Dark Knight Rises|8.4",
  "tt4154796|Avengers: Endgame|8.4",
  "tt2380307|Coco|8.4",
  "tt0086879|Amadeus|8.4",
  "tt0114709|Toy Story|8.3",
  "tt5311514|Your Name.|8.4",
  "tt0082096|Das Boot|8.4",
  "tt0364569|Oldboy|8.4",
  "tt0112573|Braveheart|8.3",
  "tt0119698|Princess Mononoke|8.3",
  "tt0057012|Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb|8.3",
  "tt1187043|3 Idiots|8.4",
  "tt0169547|American Beauty|8.3",
  "tt8267604|Capernaum|8.4",
  "tt0045152|Singin' in the Rain|8.3",
  "tt7286456|Joker|8.4",
  "tt0087843|Once Upon a Time in America|8.3",
  "tt0091251|Come and See|8.4",
  "tt0086190|Star Wars: Episode VI - Return of the Jedi|8.3",
  "tt0180093|Requiem for a Dream|8.3",
  "tt0435761|Toy Story 3|8.3",
  "tt0044741|Ikiru|8.3",
  "tt2106476|The Hunt|8.3",
  "tt1255953|Incendies|8.3",
  "tt0338013|Eternal Sunshine of the Spotless Mind|8.3",
  "tt0053604|The Apartment|8.3",
  "tt0056172|Lawrence of Arabia|8.3",
]);

const FALLBACK_TOP250_SHOWS = fromCompactFallback([
  "tt5491994|Planet Earth II|9.5",
  "tt0903747|Breaking Bad|9.5",
  "tt0185906|Band of Brothers|9.4",
  "tt0795176|Planet Earth|9.4",
  "tt7366338|Chernobyl|9.3",
  "tt0306414|The Wire|9.3",
  "tt0417299|Avatar: The Last Airbender|9.3",
  "tt6769208|Blue Planet II|9.3",
  "tt0141842|The Sopranos|9.2",
  "tt2395695|Cosmos: A Spacetime Odyssey|9.3",
  "tt0081846|Cosmos|9.3",
  "tt0944947|Game of Thrones|9.2",
  "tt9253866|The Last Dance|9.1",
  "tt2861424|Rick and Morty|9.1",
  "tt8420184|The Chosen|9.2",
  "tt1355642|Fullmetal Alchemist: Brotherhood|9.1",
  "tt1533395|Life|9.1",
  "tt1877514|The Vietnam War|9.1",
  "tt1475582|Sherlock|9.1",
  "tt0386676|The Office|9.0",
  "tt0303461|Firefly|9.0",
  "tt2098220|Hunter x Hunter|9.0",
  "tt0092337|Dekalog|9.0",
  "tt2356777|True Detective|8.9",
  "tt2560140|Attack on Titan|9.1",
  "tt0108778|Friends|8.9",
  "tt0112130|Pride and Prejudice|8.8",
  "tt0121220|Dragon Ball Z|8.8",
  "tt2085059|Black Mirror|8.7",
  "tt1856010|House of Cards|8.6",
  "tt0096697|The Simpsons|8.7",
  "tt0098936|Twin Peaks|8.8",
  "tt0213338|Cowboy Bebop|8.9",
  "tt2802850|Fargo|8.9",
  "tt0475784|Westworld|8.5",
  "tt4574334|Stranger Things|8.6",
  "tt1831164|Leyla and Mecnun|9.1",
  "tt0098904|Seinfeld|8.9",
  "tt0290978|The Blue Planet|9.0",
  "tt0773262|Dexter|8.6",
  "tt0096548|Blackadder Goes Forth|8.8",
  "tt0403778|Long Way Round|8.6",
  "tt0052520|The Twilight Zone|9.1",
  "tt0071075|Fawlty Towers|8.8",
  "tt0264235|Curb Your Enthusiasm|8.8",
  "tt0268093|Ramayan|9.0",
  "tt10233448|Vinland Saga|8.8",
  "tt8111088|The Mandalorian|8.6",
  "tt5753856|Dark|8.7",
  "tt1606375|Downton Abbey|8.7",
]);
