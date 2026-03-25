import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const TMDB_ACCESS_TOKEN = process.env.EXPO_PUBLIC_TMDB_ACCESS_TOKEN || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TMDB_ACCESS_TOKEN) {
  console.error("Missing SUPABASE or TMDB credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const BUCKET = "franchise-posters";

const STAR_WARS_COLLECTION_ID = "92db404d-0d25-4557-98d3-87f0e1b0b90b";
const HARRY_POTTER_COLLECTION_ID = "d7354372-7000-424d-90d1-9263ed2813b6";
const STAR_WARS_SLUG = "star-wars-collection";
const HARRY_POTTER_SLUG = "harry-potter-collection";

const STAR_WARS_DIR = path.resolve(__dirname, "../posters/Star Wars Collection set by Jendo7 - 2026-03-17");
const HARRY_POTTER_DIR = path.resolve(__dirname, "../posters/Harry Potter Collection set by M9D4 - 2026-03-17");

type MediaType = "movie" | "tv";

type FranchiseSpec = {
  title: string;
  year: number;
  mediaType: MediaType;
  localFile: string;
  watchOrder: number;
};

type ExistingEntry = {
  id: string;
  title: string;
  year: number | null;
  media_type: MediaType;
  tmdb_id: number | null;
};

const starWarsSpecs: FranchiseSpec[] = [
  { title: "Star Wars: Episode IV - A New Hope", year: 1977, mediaType: "movie", localFile: "Star Wars (1977).jpeg", watchOrder: 1 },
  { title: "Star Wars: Episode V - The Empire Strikes Back", year: 1980, mediaType: "movie", localFile: "The Empire Strikes Back (1980).jpeg", watchOrder: 2 },
  { title: "Star Wars: Episode VI - Return of the Jedi", year: 1983, mediaType: "movie", localFile: "Return of the Jedi (1983).jpeg", watchOrder: 3 },
  { title: "Star Wars: Episode I - The Phantom Menace", year: 1999, mediaType: "movie", localFile: "Star Wars Episode I - The Phantom Menace (1999).jpeg", watchOrder: 4 },
  { title: "Star Wars: Episode II - Attack of the Clones", year: 2002, mediaType: "movie", localFile: "Star Wars Episode II - Attack of the Clones (2002).jpeg", watchOrder: 5 },
  { title: "Star Wars: Episode III - Revenge of the Sith", year: 2005, mediaType: "movie", localFile: "Star Wars Episode III - Revenge of the Sith (2005).jpeg", watchOrder: 6 },
  { title: "Star Wars: Episode VII - The Force Awakens", year: 2015, mediaType: "movie", localFile: "Star Wars The Force Awakens (2015).jpeg", watchOrder: 7 },
  { title: "Rogue One: A Star Wars Story", year: 2016, mediaType: "movie", localFile: "Rogue One A Star Wars Story (2016).jpeg", watchOrder: 8 },
  { title: "Star Wars: Episode VIII - The Last Jedi", year: 2017, mediaType: "movie", localFile: "Star Wars The Last Jedi (2017).jpeg", watchOrder: 9 },
  { title: "Solo: A Star Wars Story", year: 2018, mediaType: "movie", localFile: "Solo A Star Wars Story (2018).jpeg", watchOrder: 10 },
  { title: "Star Wars: Episode IX - The Rise of Skywalker", year: 2019, mediaType: "movie", localFile: "Star Wars The Rise of Skywalker (2019).jpeg", watchOrder: 11 },
  { title: "The Mandalorian", year: 2019, mediaType: "tv", localFile: "The Mandalorian (2019).jpeg", watchOrder: 12 },
  { title: "The Book of Boba Fett", year: 2021, mediaType: "tv", localFile: "The Book of Boba Fett (2021).png", watchOrder: 13 },
  { title: "Obi-Wan Kenobi", year: 2022, mediaType: "tv", localFile: "Obi-Wan Kenobi (2022).png", watchOrder: 14 },
  { title: "Andor", year: 2022, mediaType: "tv", localFile: "Andor (2022).jpg", watchOrder: 15 },
  { title: "Ahsoka", year: 2023, mediaType: "tv", localFile: "Ahsoka (2023).png", watchOrder: 16 },
  { title: "The Acolyte", year: 2024, mediaType: "tv", localFile: "The Acolyte (2024).png", watchOrder: 17 },
  { title: "Skeleton Crew", year: 2024, mediaType: "tv", localFile: "Star Wars- Skeleton Crew (2024).jpg", watchOrder: 18 },
];

const harryPotterNewSpecs: FranchiseSpec[] = [
  { title: "Fantastic Beasts and Where to Find Them", year: 2016, mediaType: "movie", localFile: "Fantastic Beasts and Where to Find Them (2016).png", watchOrder: 9 },
  { title: "Fantastic Beasts: The Crimes of Grindelwald", year: 2018, mediaType: "movie", localFile: "Fantastic Beasts- The Crimes of Grindelwald (2018) (1).png", watchOrder: 10 },
  { title: "Fantastic Beasts: The Secrets of Dumbledore", year: 2022, mediaType: "movie", localFile: "Fantastic Beasts- The Secrets of Dumbledore (2022).png", watchOrder: 11 },
];

function getContentType(extension: string) {
  switch (extension.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".jpg":
    case ".jpeg":
    default:
      return "image/jpeg";
  }
}

function sanitizeRemoteName(fileName: string) {
  return fileName.replace(/[^a-z0-9. \-\(\)_']/gi, "_");
}

function normalizeTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[:']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateNote(value: string | null) {
  if (!value) return null;
  return value.length > 200 ? `${value.slice(0, 197)}...` : value;
}

async function uploadAsset(slug: string, localDir: string, fileName: string) {
  const localPath = path.join(localDir, fileName);
  if (!fs.existsSync(localPath)) {
    throw new Error(`Missing file: ${localPath}`);
  }

  const remotePath = `${slug}/${sanitizeRemoteName(fileName)}`;
  const fileBuffer = fs.readFileSync(localPath);
  const extension = path.extname(fileName);
  const { error } = await supabase.storage.from(BUCKET).upload(remotePath, fileBuffer, {
    upsert: true,
    contentType: getContentType(extension),
  });

  if (error) {
    throw new Error(`Failed to upload ${fileName}: ${error.message}`);
  }

  return supabase.storage.from(BUCKET).getPublicUrl(remotePath).data.publicUrl;
}

async function listStorageFiles(prefix: string) {
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 200 });
  if (error) {
    throw new Error(`Failed to list ${prefix}: ${error.message}`);
  }
  return data || [];
}

async function clearStoragePrefix(prefix: string) {
  const files = await listStorageFiles(prefix);
  if (files.length === 0) return;
  const paths = files.map((file) => `${prefix}/${file.name}`);
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    throw new Error(`Failed to clear ${prefix}: ${error.message}`);
  }
}

async function fetchTmdbMatch(spec: FranchiseSpec) {
  const endpoint = spec.mediaType === "tv" ? "tv" : "movie";
  const searchUrl = new URL(`https://api.themoviedb.org/3/search/${endpoint}`);
  searchUrl.searchParams.set("query", spec.title);
  searchUrl.searchParams.set("language", "en-US");
  if (spec.mediaType === "movie") {
    searchUrl.searchParams.set("primary_release_year", String(spec.year));
  } else {
    searchUrl.searchParams.set("first_air_date_year", String(spec.year));
  }

  const searchResponse = await fetch(searchUrl.toString(), {
    headers: {
      Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
      accept: "application/json",
    },
  });

  if (!searchResponse.ok) {
    throw new Error(`TMDB search failed for ${spec.title}: ${searchResponse.status}`);
  }

  const searchPayload = await searchResponse.json() as { results?: Array<Record<string, any>> };
  const results = Array.isArray(searchPayload.results) ? searchPayload.results : [];
  if (results.length === 0) {
    return null;
  }

  const exact = results.find((result) => {
    const resultTitle = spec.mediaType === "tv" ? result.name : result.title;
    const resultYear = spec.mediaType === "tv"
      ? Number(String(result.first_air_date || "").slice(0, 4))
      : Number(String(result.release_date || "").slice(0, 4));
    return normalizeTitle(String(resultTitle || "")) === normalizeTitle(spec.title) && resultYear === spec.year;
  }) || results[0];

  const detailsResponse = await fetch(`https://api.themoviedb.org/3/${endpoint}/${exact.id}?language=en-US`, {
    headers: {
      Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
      accept: "application/json",
    },
  });

  if (!detailsResponse.ok) {
    throw new Error(`TMDB details failed for ${spec.title}: ${detailsResponse.status}`);
  }

  const details = await detailsResponse.json() as Record<string, any>;
  return {
    id: exact.id as number,
    tagline: typeof details.tagline === "string" && details.tagline.trim().length > 0 ? details.tagline : null,
    overview: typeof details.overview === "string" && details.overview.trim().length > 0 ? details.overview : null,
    runtimeMinutes: spec.mediaType === "tv"
      ? (Array.isArray(details.episode_run_time) ? details.episode_run_time[0] ?? null : null)
      : (typeof details.runtime === "number" ? details.runtime : null),
    episodeCount: spec.mediaType === "tv" && typeof details.number_of_episodes === "number"
      ? details.number_of_episodes
      : null,
  };
}

async function fetchExistingEntries(franchiseId: string) {
  const { data, error } = await supabase
    .from("franchise_entries")
    .select("id,title,year,media_type,tmdb_id")
    .eq("franchise_id", franchiseId)
    .order("watch_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch entries for ${franchiseId}: ${error.message}`);
  }

  return (data || []) as ExistingEntry[];
}

async function setTemporaryOrders(franchiseId: string, entries: ExistingEntry[]) {
  for (const [index, entry] of entries.entries()) {
    const { error } = await supabase
      .from("franchise_entries")
      .update({ watch_order: 100 + index })
      .eq("id", entry.id);
    if (error) {
      throw new Error(`Failed to stage ${entry.title}: ${error.message}`);
    }
  }
}

async function syncStarWars() {
  console.log("Syncing Star Wars collection...");
  const existingEntries = await fetchExistingEntries(STAR_WARS_COLLECTION_ID);
  await setTemporaryOrders(STAR_WARS_COLLECTION_ID, existingEntries);
  await clearStoragePrefix(STAR_WARS_SLUG);

  const logoUrl = await uploadAsset(STAR_WARS_SLUG, STAR_WARS_DIR, "Star Wars The Complete Collection.png");
  await supabase.from("franchise_collections").update({
    logo_url: logoUrl,
    total_entries: starWarsSpecs.length,
  }).eq("id", STAR_WARS_COLLECTION_ID);

  const existingByTmdb = new Map<number, ExistingEntry>();
  const existingByTitleYear = new Map<string, ExistingEntry>();
  for (const entry of existingEntries) {
    if (entry.tmdb_id) {
      existingByTmdb.set(entry.tmdb_id, entry);
    }
    existingByTitleYear.set(`${normalizeTitle(entry.title)}:${entry.year}:${entry.media_type}`, entry);
  }

  const keepIds = new Set<string>();

  for (const spec of starWarsSpecs) {
    const tmdb = await fetchTmdbMatch(spec);
    const posterUrl = await uploadAsset(STAR_WARS_SLUG, STAR_WARS_DIR, spec.localFile);
    const payload = {
      franchise_id: STAR_WARS_COLLECTION_ID,
      title: spec.title,
      year: spec.year,
      media_type: spec.mediaType,
      watch_order: spec.watchOrder,
      tmdb_id: tmdb?.id ?? null,
      poster_url: posterUrl,
      runtime_minutes: tmdb?.runtimeMinutes ?? null,
      episode_count: tmdb?.episodeCount ?? null,
      tagline: tmdb?.tagline ?? null,
      note: truncateNote(tmdb?.overview ?? null),
      is_released: spec.year <= 2026,
    };

    const existing = (tmdb?.id ? existingByTmdb.get(tmdb.id) : null)
      || existingByTitleYear.get(`${normalizeTitle(spec.title)}:${spec.year}:${spec.mediaType}`);

    if (existing) {
      const { error } = await supabase.from("franchise_entries").update(payload).eq("id", existing.id);
      if (error) {
        throw new Error(`Failed to update ${spec.title}: ${error.message}`);
      }
      keepIds.add(existing.id);
    } else {
      const { data, error } = await supabase.from("franchise_entries").insert(payload).select("id").single();
      if (error || !data) {
        throw new Error(`Failed to insert ${spec.title}: ${error?.message ?? "unknown error"}`);
      }
      keepIds.add(data.id);
    }

    console.log(`Synced Star Wars entry: ${spec.title}`);
  }

  const obsoleteIds = existingEntries.filter((entry) => !keepIds.has(entry.id)).map((entry) => entry.id);
  if (obsoleteIds.length > 0) {
    const { error } = await supabase.from("franchise_entries").delete().in("id", obsoleteIds);
    if (error) {
      throw new Error(`Failed to delete obsolete Star Wars entries: ${error.message}`);
    }
  }
}

async function syncHarryPotter() {
  console.log("Syncing Harry Potter expansion...");
  const existingEntries = await fetchExistingEntries(HARRY_POTTER_COLLECTION_ID);
  const existingByTmdb = new Map<number, ExistingEntry>();
  const existingByTitleYear = new Map<string, ExistingEntry>();
  for (const entry of existingEntries) {
    if (entry.tmdb_id) {
      existingByTmdb.set(entry.tmdb_id, entry);
    }
    existingByTitleYear.set(`${normalizeTitle(entry.title)}:${entry.year}:${entry.media_type}`, entry);
  }

  for (const spec of harryPotterNewSpecs) {
    const tmdb = await fetchTmdbMatch(spec);
    const posterUrl = await uploadAsset(HARRY_POTTER_SLUG, HARRY_POTTER_DIR, spec.localFile);
    const payload = {
      franchise_id: HARRY_POTTER_COLLECTION_ID,
      title: spec.title,
      year: spec.year,
      media_type: "movie" as const,
      watch_order: spec.watchOrder,
      tmdb_id: tmdb?.id ?? null,
      poster_url: posterUrl,
      runtime_minutes: tmdb?.runtimeMinutes ?? null,
      episode_count: null,
      tagline: tmdb?.tagline ?? null,
      note: truncateNote(tmdb?.overview ?? null),
      is_released: true,
    };

    const existing = (tmdb?.id ? existingByTmdb.get(tmdb.id) : null)
      || existingByTitleYear.get(`${normalizeTitle(spec.title)}:${spec.year}:movie`);

    if (existing) {
      const { error } = await supabase.from("franchise_entries").update(payload).eq("id", existing.id);
      if (error) {
        throw new Error(`Failed to update ${spec.title}: ${error.message}`);
      }
    } else {
      const { error } = await supabase.from("franchise_entries").insert(payload);
      if (error) {
        throw new Error(`Failed to insert ${spec.title}: ${error.message}`);
      }
    }

    console.log(`Synced Harry Potter entry: ${spec.title}`);
  }

  await supabase.from("franchise_collections").update({
    total_entries: 11,
  }).eq("id", HARRY_POTTER_COLLECTION_ID);
}

async function main() {
  await syncStarWars();
  await syncHarryPotter();
  console.log("Star Wars and Harry Potter sync complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
