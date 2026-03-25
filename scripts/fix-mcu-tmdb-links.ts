import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type MediaType = "movie" | "tv";

type FixTarget = {
  title: string;
  year?: number;
  mediaType: MediaType;
  tmdbId: number;
  episodeCount?: null;
};

const MCU_SLUG = "marvel-cinematic-universe";

const targets: FixTarget[] = [
  { title: "Echo", mediaType: "tv", tmdbId: 122226 },
  { title: "Ironheart", mediaType: "tv", tmdbId: 114471 },
  { title: "The Guardians of the Galaxy Holiday Special", mediaType: "movie", tmdbId: 774752, episodeCount: null },
  { title: "Werewolf by Night", mediaType: "movie", tmdbId: 894205, episodeCount: null },
];

async function getMcuCollectionId() {
  const { data, error } = await supabase
    .from("franchise_collections")
    .select("id,title,slug")
    .eq("slug", MCU_SLUG)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to load MCU collection: ${error?.message ?? "not found"}`);
  }

  return data.id as string;
}

async function main() {
  const franchiseId = await getMcuCollectionId();

  for (const target of targets) {
    const { data: existing, error: loadError } = await supabase
      .from("franchise_entries")
      .select("id,title,year,media_type,tmdb_id,episode_count")
      .eq("franchise_id", franchiseId)
      .eq("title", target.title)
      .maybeSingle();

    if (loadError || !existing) {
      throw new Error(`Failed to load ${target.title}: ${loadError?.message ?? "not found"}`);
    }

    const updatePayload: {
      media_type: MediaType;
      tmdb_id: number;
      episode_count?: null;
    } = {
      media_type: target.mediaType,
      tmdb_id: target.tmdbId,
    };

    if (Object.prototype.hasOwnProperty.call(target, "episodeCount")) {
      updatePayload.episode_count = target.episodeCount;
    }

    const { error: updateError } = await supabase
      .from("franchise_entries")
      .update(updatePayload)
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(`Failed to update ${target.title}: ${updateError.message}`);
    }

    console.log(
      [
        `Updated ${target.title}`,
        existing.year ? `year: ${existing.year}` : null,
        `media_type: ${existing.media_type} -> ${target.mediaType}`,
        `tmdb_id: ${existing.tmdb_id} -> ${target.tmdbId}`,
        Object.prototype.hasOwnProperty.call(target, "episodeCount")
          ? `episode_count: ${existing.episode_count ?? "null"} -> ${target.episodeCount ?? "null"}`
          : null,
      ]
        .filter(Boolean)
        .join(" | ")
    );
  }

  const { data: verification, error: verifyError } = await supabase
    .from("franchise_entries")
    .select("title,year,media_type,tmdb_id,episode_count")
    .eq("franchise_id", franchiseId)
    .in(
      "title",
      targets.map((target) => target.title)
    )
    .order("year", { ascending: true });

  if (verifyError) {
    throw new Error(`Failed to verify MCU entries: ${verifyError.message}`);
  }

  console.log("Verification:");
  for (const row of verification ?? []) {
    console.log(
      `${row.title} (${row.year}) -> ${row.media_type} / ${row.tmdb_id} / episode_count=${row.episode_count ?? "null"}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
