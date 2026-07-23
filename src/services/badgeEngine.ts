// Computes profile badge progress from watch history. Pure and structural on
// purpose: retroactive over existing history (including Letterboxd imports),
// consistent across devices via the existing history sync, and needs no new
// storage or DB tables. Genre matching lists both TMDB language variants the
// app ships (en + tr), same approach as personaClassifier.

import { BADGE_DEFINITIONS, BADGE_DEFINITION_MAP, type BadgeId } from "../constants/badges";

export type BadgeHistoryEntry = {
  id: number | string;
  sourceTmdbId?: number | null;
  mediaType: string;
  historyKind?: string;
  genres?: string[];
  runtimeMinutes?: number | null;
  episodeCount?: number | null;
  year?: string;
  directorIds?: number[];
  watchedAt?: number;
  watchPrecision?: string;
};

export type BadgeProgress = {
  id: BadgeId;
  target: number;
  current: number;
  earned: boolean;
};

const GENRE_BUCKETS = {
  horror: ["horror", "korku"],
  comedy: ["comedy", "komedi"],
  romance: ["romance", "romantik"],
  crimeMystery: ["crime", "suç", "mystery", "gizem"],
  scifi: [
    "science fiction",
    "bilim-kurgu",
    "fantasy",
    "fantastik",
    "sci-fi & fantasy",
    "bilim kurgu & fantazi",
  ],
} as const;

type GenreBucket = keyof typeof GENRE_BUCKETS;

function entryMatchesBucket(entry: BadgeHistoryEntry, bucket: GenreBucket) {
  const names = GENRE_BUCKETS[bucket];
  return (entry.genres ?? []).some((genre) => names.includes(genre.trim().toLowerCase() as never));
}

function isTitleEntry(entry: BadgeHistoryEntry) {
  return entry.historyKind !== "season";
}

function parseYear(entry: BadgeHistoryEntry): number | null {
  const year = Number.parseInt(entry.year ?? "", 10);
  return Number.isFinite(year) && year > 1880 && year < 2200 ? year : null;
}

function seriesKey(entry: BadgeHistoryEntry) {
  const tmdbId =
    typeof entry.sourceTmdbId === "number" && Number.isFinite(entry.sourceTmdbId) && entry.sourceTmdbId > 0
      ? entry.sourceTmdbId
      : entry.id;
  return String(tmdbId);
}

function localDayKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Episodes per series without double counting whole-show + per-season logs. */
function countEpisodes(entries: BadgeHistoryEntry[]) {
  const titleEpisodes = new Map<string, number>();
  const seasonEpisodes = new Map<string, number>();

  for (const entry of entries) {
    if (entry.mediaType !== "tv") {
      continue;
    }

    const key = seriesKey(entry);
    const episodes = typeof entry.episodeCount === "number" && entry.episodeCount > 0 ? entry.episodeCount : 0;
    if (isTitleEntry(entry)) {
      titleEpisodes.set(key, Math.max(titleEpisodes.get(key) ?? 0, episodes));
    } else {
      seasonEpisodes.set(key, (seasonEpisodes.get(key) ?? 0) + episodes);
    }
  }

  let total = 0;
  const allKeys = new Set([...titleEpisodes.keys(), ...seasonEpisodes.keys()]);
  for (const key of allKeys) {
    total += Math.max(titleEpisodes.get(key) ?? 0, seasonEpisodes.get(key) ?? 0);
  }

  return total;
}

export function evaluateBadges(history: BadgeHistoryEntry[]): BadgeProgress[] {
  const titles = history.filter(isTitleEntry);
  const movieTitles = titles.filter((entry) => entry.mediaType === "movie");

  const genreCounts: Record<GenreBucket, number> = {
    horror: 0,
    comedy: 0,
    romance: 0,
    crimeMystery: 0,
    scifi: 0,
  };
  for (const entry of titles) {
    for (const bucket of Object.keys(GENRE_BUCKETS) as GenreBucket[]) {
      if (entryMatchesBucket(entry, bucket)) {
        genreCounts[bucket] += 1;
      }
    }
  }

  // Marathon: 3+ titles logged on the same calendar day. Only day-precision
  // logs count — month-precision imports all collapse onto the same date and
  // would fake a marathon.
  const dayCounts = new Map<string, number>();
  let marathonBest = 0;
  for (const entry of titles) {
    if (entry.watchPrecision !== "day" || typeof entry.watchedAt !== "number") {
      continue;
    }
    const key = localDayKey(entry.watchedAt);
    const count = (dayCounts.get(key) ?? 0) + 1;
    dayCounts.set(key, count);
    marathonBest = Math.max(marathonBest, count);
  }

  const decades = new Set<number>();
  let preEightiesCount = 0;
  for (const entry of movieTitles) {
    const year = parseYear(entry);
    if (year === null) {
      continue;
    }
    decades.add(Math.floor(year / 10) * 10);
    if (year < 1980) {
      preEightiesCount += 1;
    }
  }

  const directorCounts = new Map<number, number>();
  let directorBest = 0;
  for (const entry of movieTitles) {
    for (const directorId of entry.directorIds ?? []) {
      const count = (directorCounts.get(directorId) ?? 0) + 1;
      directorCounts.set(directorId, count);
      directorBest = Math.max(directorBest, count);
    }
  }

  let totalMinutes = 0;
  for (const entry of history) {
    if (typeof entry.runtimeMinutes === "number" && entry.runtimeMinutes > 0) {
      totalMinutes += entry.runtimeMinutes;
    }
  }

  // October horror: month-precision logs still count (the user explicitly
  // picked October), undated logs do not.
  let octoberHorror = 0;
  for (const entry of titles) {
    if (
      entryMatchesBucket(entry, "horror")
      && typeof entry.watchedAt === "number"
      && entry.watchPrecision !== "none"
      && new Date(entry.watchedAt).getMonth() === 9
    ) {
      octoberHorror += 1;
    }
  }

  const currents: Record<BadgeId, number> = {
    firstReel: movieTitles.length,
    rookie: movieTitles.length,
    regular: movieTitles.length,
    movieBuff: movieTitles.length,
    cinephile: movieTitles.length,
    filmFanatic: movieTitles.length,
    screenLegend: movieTitles.length,
    fearCollector: genreCounts.horror,
    laughTrack: genreCounts.comedy,
    heartlines: genreCounts.romance,
    caseClosed: genreCounts.crimeMystery,
    starbound: genreCounts.scifi,
    marathonDay: marathonBest,
    timeTraveler: decades.size,
    oldSoul: preEightiesCount,
    directorsCircle: directorBest,
    hundredHours: totalMinutes,
    seasonSlayer: countEpisodes(history),
    octoberRites: octoberHorror,
  };

  return BADGE_DEFINITIONS.map((definition) => {
    const current = currents[definition.id];
    return {
      id: definition.id,
      target: definition.target,
      current,
      earned: current >= definition.target,
    };
  });
}

/**
 * Badges shown in the profile strip: the highest earned ladder tier plus all
 * other earned badges, in catalog order.
 */
export function selectStripBadgeIds(progress: BadgeProgress[]): BadgeId[] {
  let topLadder: { id: BadgeId; rank: number } | null = null;
  const others: BadgeId[] = [];

  for (const status of progress) {
    if (!status.earned) {
      continue;
    }

    const definition = BADGE_DEFINITION_MAP.get(status.id);
    if (!definition) {
      continue;
    }

    if (typeof definition.ladderRank === "number") {
      if (!topLadder || definition.ladderRank > topLadder.rank) {
        topLadder = { id: status.id, rank: definition.ladderRank };
      }
    } else {
      others.push(status.id);
    }
  }

  return topLadder ? [topLadder.id, ...others] : others;
}
