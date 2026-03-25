import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const BUCKET = "franchise-posters";
const BUCKET_URL = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}`;

async function main() {
  // ── 1. SCREAM (1996) ───────────────────────────────────────────────────
  console.log("Fixing Scream (1996)...");
  const screamId = 'f145c977-d6fa-4d69-bbb1-ee49a4f8f8dc';
  const scream1996Url = `${BUCKET_URL}/scream-collection/Scream%20(1996).png`;
  
  // Re-shift all Scream movies to leave space at watch_order 1
  // Set current orders to be correct
  await supabase.from("franchise_entries").update({ watch_order: 2 }).eq("franchise_id", screamId).eq("year", 1997);
  await supabase.from("franchise_entries").update({ watch_order: 3 }).eq("franchise_id", screamId).eq("year", 2000);
  await supabase.from("franchise_entries").update({ watch_order: 4 }).eq("franchise_id", screamId).eq("year", 2011);
  await supabase.from("franchise_entries").update({ watch_order: 5 }).eq("franchise_id", screamId).eq("year", 2022);
  await supabase.from("franchise_entries").update({ watch_order: 6 }).eq("franchise_id", screamId).eq("year", 2023);
  await supabase.from("franchise_entries").update({ watch_order: 7 }).eq("franchise_id", screamId).eq("year", 2026);

  await supabase.from("franchise_entries").upsert({
    franchise_id: screamId,
    title: "Scream",
    year: 1996,
    tmdb_id: 4232,
    media_type: "movie",
    watch_order: 1,
    poster_url: scream1996Url,
    is_released: true
  });

  // ── 2. DUNE: PART THREE ──────────────────────────────────────────────
  console.log("Fixing Dune: Part Three...");
  const duneId = 'c50ce365-53dd-4d1e-83ce-2e1b31f342a0';
  const duneUrl = `${BUCKET_URL}/dune-collection/Dune-%20Part%20Three%20(2026).jpg`;
  await supabase.from("franchise_entries").update({ poster_url: duneUrl }).eq("franchise_id", duneId).eq("title", "Dune: Part Three");

  // ── 3. JASON BOURNE (2016) ──────────────────────────────────────────────
  console.log("Fixing Jason Bourne (2016)...");
  const bourneId = '0b8425d2-0be5-41df-b085-9d6e62cdd23b';
  const jasonBournePoster = `${BUCKET_URL}/the-bourne-collection/Jason%20Bourne%20(2016).jpg`;
  
  await supabase.from("franchise_entries").upsert({
    franchise_id: bourneId,
    title: "Jason Bourne",
    year: 2016,
    tmdb_id: 324668,
    media_type: "movie",
    watch_order: 5,
    poster_url: jasonBournePoster,
    is_released: true
  });

  // Final count check for all
  for (const fid of [screamId, duneId, bourneId]) {
    const { data: entries } = await supabase.from("franchise_entries").select("id").eq("franchise_id", fid);
    if (entries) {
      await supabase.from("franchise_collections").update({ total_entries: entries.length }).eq("id", fid);
    }
  }

  console.log("All fixes complete!");
}

main().catch(console.error);
