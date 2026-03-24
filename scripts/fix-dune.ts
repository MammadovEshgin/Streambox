import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const TMDB_ACCESS_TOKEN = process.env.EXPO_PUBLIC_TMDB_ACCESS_TOKEN || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const BUCKET = "franchise-posters";

const SLUG = "dune-collection";
const DUNE_DIR = path.resolve(__dirname, "../posters/Dune collection");

async function fetchTmdbSeries(title: string) {
  try {
    const url = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(title)}&language=en-US`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
        accept: "application/json",
      },
    });
    const data = await res.json();
    return data.results && data.results.length > 0 ? data.results[0] : null;
  } catch (error) {
    console.error(`TMDB search failed for series ${title}:`, error);
  }
  return null;
}

async function fetchTmdbSeriesDetails(tmdbId: number) {
  try {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}?language=en-US`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
        accept: "application/json",
      },
    });
    return await res.json();
  } catch (error) {
    console.error(`TMDB details failed for series ${tmdbId}:`, error);
  }
  return null;
}

async function main() {
  const { data: collection } = await supabase
    .from("franchise_collections")
    .select("id")
    .eq("slug", SLUG)
    .single();

  if (!collection) {
    console.error("Collection not found");
    return;
  }

  const franchiseId = collection.id;

  // 1. Fix Dune- Prophecy
  console.log("Fixing Dune- Prophecy...");
  const tmdbSeries = await fetchTmdbSeries("Dune: Prophecy");
  if (tmdbSeries) {
    const details = await fetchTmdbSeriesDetails(tmdbSeries.id);
    await supabase.from("franchise_entries").update({
      media_type: "tv",
      tmdb_id: tmdbSeries.id,
      runtime_minutes: details?.episode_run_time ? (details.episode_run_time[0] || 60) : 60,
      episode_count: details?.number_of_episodes || 6,
      tagline: details?.tagline || null,
      note: details?.overview || null,
    }).match({ franchise_id: franchiseId, title: "Dune- Prophecy" });
    console.log("✓ Done");
  }

  // 2. Add Dune- Part Three
  console.log("Adding Dune- Part Three...");
  const fileName = "Dune- Part Three (2026).jpg";
  const filePath = path.join(DUNE_DIR, fileName);
  if (fs.existsSync(filePath)) {
    const fileBuffer = fs.readFileSync(filePath);
    const remotePath = `${SLUG}/${fileName}`;
    
    // Upload
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(remotePath, fileBuffer, { upsert: true, contentType: "image/jpeg" });
      
    if (!uploadError) {
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(remotePath);
      
      // Upsert entry - watch_order 4 assuming Part 1 (1), Part 2 (2), Prophecy (3) or something
      // Let's re-order them logically:
      // 1. Dune (2021)
      // 2. Dune - Part Two (2024)
      // 3. Dune - Prophecy (2024) - Series
      // 4. Dune - Part Three (2026)
      await supabase.from("franchise_entries").upsert({
        franchise_id: franchiseId,
        title: "Dune- Part Three",
        year: 2026,
        media_type: "movie",
        watch_order: 4,
        poster_url: urlData.publicUrl,
        is_released: false
      }, { onConflict: "franchise_id,title" });
      console.log("✓ Done");
    } else {
       console.error("Upload error:", uploadError.message);
    }
  } else {
    console.error("File not found:", fileName);
  }

  // 3. Update collection count
  const { data: entries } = await supabase.from("franchise_entries").select("id").eq("franchise_id", franchiseId);
  if (entries) {
    await supabase.from("franchise_collections").update({ total_entries: entries.length }).eq("id", franchiseId);
  }
}

main().catch(console.error);
