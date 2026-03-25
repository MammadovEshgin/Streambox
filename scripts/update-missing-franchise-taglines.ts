import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const TMDB_ACCESS_TOKEN = process.env.EXPO_PUBLIC_TMDB_ACCESS_TOKEN || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TMDB_ACCESS_TOKEN) {
  console.error("Missing SUPABASE or TMDB credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const targets = [
  { title: "Jason Bourne", year: 2016, mediaType: "movie" as const },
  { title: "Scream", year: 1996, mediaType: "movie" as const },
  { title: "The Lord of the Rings: The Rings of Power", year: 2022, mediaType: "tv" as const },
];

async function fetchTmdbDetails(tmdbId: number, mediaType: "movie" | "tv") {
  const endpoint = mediaType === "tv" ? "tv" : "movie";
  const response = await fetch(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}?language=en-US`, {
    headers: {
      Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`TMDB ${endpoint} details failed with status ${response.status}`);
  }

  return response.json() as Promise<{ tagline?: string | null }>;
}

async function main() {
  for (const target of targets) {
    const { data: entry, error } = await supabase
      .from("franchise_entries")
      .select("id, title, year, media_type, tmdb_id, tagline")
      .eq("title", target.title)
      .eq("year", target.year)
      .eq("media_type", target.mediaType)
      .maybeSingle();

    if (error || !entry) {
      throw new Error(`Failed to load ${target.title} (${target.year}): ${error?.message ?? "not found"}`);
    }

    if (!entry.tmdb_id) {
      throw new Error(`Missing tmdb_id for ${target.title} (${target.year})`);
    }

    const details = await fetchTmdbDetails(entry.tmdb_id, target.mediaType);
    const tagline = typeof details.tagline === "string" && details.tagline.trim().length > 0
      ? details.tagline.trim()
      : null;

    if (!tagline) {
      throw new Error(`TMDB returned no tagline for ${target.title} (${target.year})`);
    }

    const { error: updateError } = await supabase
      .from("franchise_entries")
      .update({ tagline })
      .eq("id", entry.id);

    if (updateError) {
      throw new Error(`Failed to update tagline for ${target.title}: ${updateError.message}`);
    }

    console.log(`Updated ${target.title} (${target.year}) -> ${tagline}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
