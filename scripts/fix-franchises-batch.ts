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

async function fetchTmdbMovie(title: string, year: number) {
  try {
    const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(title)}&primary_release_year=${year}&language=en-US`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`, accept: "application/json" },
    });
    const data = await res.json();
    return data.results && data.results.length > 0 ? data.results[0] : null;
  } catch (error) {
    console.error(`TMDB search failed for ${title}:`, error);
  }
  return null;
}

async function fetchTmdbSeries(title: string) {
  try {
    const url = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(title)}&language=en-US`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`, accept: "application/json" },
    });
    const data = await res.json();
    return data.results && data.results.length > 0 ? data.results[0] : null;
  } catch (error) {
    console.error(`TMDB search failed for ${title}:`, error);
  }
  return null;
}

async function uploadFile(folder: string, filename: string, localPath: string) {
  if (!fs.existsSync(localPath)) {
    console.error(`File does not exist: ${localPath}`);
    return null;
  }
  const fileBuffer = fs.readFileSync(localPath);
  const ext = path.extname(filename).substring(1);
  const cleanFilename = filename.replace(/[^a-z0-9. \-\(\)_]/gi, '_');
  const remotePath = `${folder}/${cleanFilename}`;
  
  const { error } = await supabase.storage.from(BUCKET).upload(remotePath, fileBuffer, {
    upsert: true,
    contentType: ext === "png" ? "image/png" : "image/jpeg"
  });
  
  if (error) {
    console.error(`Upload failed for ${filename}:`, error.message);
    return null;
  }
  
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(remotePath);
  return data.publicUrl;
}

async function main() {
  // ── 1. SCREAM (1996) ───────────────────────────────────────────────────
  console.log("Fixing Scream (1996)...");
  const screamId = 'f145c977-d6fa-4d69-bbb1-ee49a4f8f8dc';
  const screamDir = "./posters/Scream Collection set by cinemoire - 2026-03-24";
  const scream1996File = "Scream (1996).png";
  const scream1996Url = await uploadFile("scream-collection", scream1996File, path.join(screamDir, scream1996File));
  
  if (scream1996Url) {
    const tmdb = await fetchTmdbMovie("Scream", 1996);
    await supabase.from("franchise_entries").upsert({
      franchise_id: screamId,
      title: "Scream (1996)",
      year: 1996,
      tmdb_id: tmdb?.id || null,
      media_type: "movie",
      watch_order: 1, // Set 1996 to index 1
      poster_url: scream1996Url,
      is_released: true
    }, { onConflict: "franchise_id,title,year" });
    
    // Update others orders
    await supabase.from("franchise_entries").update({ watch_order: 2 }).eq("franchise_id", screamId).eq("year", 1997);
    await supabase.from("franchise_entries").update({ watch_order: 3 }).eq("franchise_id", screamId).eq("year", 2000);
    await supabase.from("franchise_entries").update({ watch_order: 4 }).eq("franchise_id", screamId).eq("year", 2011);
    await supabase.from("franchise_entries").update({ watch_order: 5 }).eq("franchise_id", screamId).eq("year", 2022);
    await supabase.from("franchise_entries").update({ watch_order: 6 }).eq("franchise_id", screamId).eq("year", 2023);
    await supabase.from("franchise_entries").update({ watch_order: 7 }).eq("franchise_id", screamId).eq("year", 2026);
  }

  // ── 2. FAST FOREVER (2028) ──────────────────────────────────────────────
  console.log("Fixing Fast Forever (2028)...");
  const fastId = '5096e4c0-995e-44c8-950a-4647f4486db3';
  const fastDir = "./posters/The Fast and the Furious Collection set by ishalioh - 2026-03-24";
  const fastForeverFile = "Fast Forever (2028).png";
  const fastForeverUrl = await uploadFile("the-fast-and-the-furious-collection", fastForeverFile, path.join(fastDir, fastForeverFile));
  
  if (fastForeverUrl) {
    await supabase.from("franchise_entries").upsert({
      franchise_id: fastId,
      title: "Fast Forever",
      year: 2028,
      media_type: "movie",
      watch_order: 12,
      poster_url: fastForeverUrl,
      is_released: false
    }, { onConflict: "franchise_id,title" });
  }

  // ── 3. BOURNE COLLECTION ──────────────────────────────────────────────
  console.log("Updating Bourne Collection posters...");
  const bourneId = '0b8425d2-0be5-41df-b085-9d6e62cdd23b';
  const bourneDir = "./posters/The Bourne Collection set by poephan - 2026-03-17";
  const bourneFiles = fs.readdirSync(bourneDir);
  
  for (const f of bourneFiles) {
    const url = await uploadFile("the-bourne-collection", f, path.join(bourneDir, f));
    if (url) {
      if (f.includes("(2002)")) await supabase.from("franchise_entries").update({ poster_url: url }).eq("franchise_id", bourneId).eq("year", 2002);
      if (f.includes("(2004)")) await supabase.from("franchise_entries").update({ poster_url: url }).eq("franchise_id", bourneId).eq("year", 2004);
      if (f.includes("(2007)")) await supabase.from("franchise_entries").update({ poster_url: url }).eq("franchise_id", bourneId).eq("year", 2007);
      if (f.includes("(2012)")) await supabase.from("franchise_entries").update({ poster_url: url }).eq("franchise_id", bourneId).eq("year", 2012);
      if (f.includes("(2016)")) {
          // Both Jason Bourne and Bourne Legacy might have 2016 if named weird, but Bourne Legacy was 2012. Jason Bourne is 2016.
          await supabase.from("franchise_entries").update({ poster_url: url }).eq("franchise_id", bourneId).eq("year", 2016);
      }
      if (!f.includes("(")) await supabase.from("franchise_collections").update({ logo_url: url }).eq("id", bourneId);
    }
  }

  // ── 4. MIDDLE-EARTH ──────────────────────────────────────────────────
  console.log("Fixing Middle-Earth Order & Rings of Power...");
  const meId = '42b265ff-ef76-4285-bb84-49c40b056d49';
  const meDir = "./posters/Middle-Earth Collection set by mikenobbs - 2026-03-17";
  
  // Hobbit first (1,2,3) then LOTR (4,5,6)
  await supabase.from("franchise_entries").update({ watch_order: 1 }).eq("franchise_id", meId).eq("title", "The Hobbit An Unexpected Journey");
  await supabase.from("franchise_entries").update({ watch_order: 2 }).eq("franchise_id", meId).eq("title", "The Hobbit The Desolation of Smaug");
  await supabase.from("franchise_entries").update({ watch_order: 3 }).eq("franchise_id", meId).eq("title", "The Hobbit The Battle of the Five Armies");
  await supabase.from("franchise_entries").update({ watch_order: 4 }).eq("franchise_id", meId).eq("title", "The Lord of the Rings The Fellowship of the Ring");
  await supabase.from("franchise_entries").update({ watch_order: 5 }).eq("franchise_id", meId).eq("title", "The Lord of the Rings The Two Towers");
  await supabase.from("franchise_entries").update({ watch_order: 6 }).eq("franchise_id", meId).eq("title", "The Lord of the Rings The Return of the King");
  
  // Rings of Power at the end (7)
  const ropFile = "The Lord of the Rings- The Rings of Power (2022).png";
  const ropUrl = await uploadFile("middle-earth-collection", ropFile, path.join(meDir, ropFile));
  
  if (ropUrl) {
    const tmdb = await fetchTmdbSeries("The Lord of the Rings: The Rings of Power");
    await supabase.from("franchise_entries").upsert({
      franchise_id: meId,
      title: "The Lord of the Rings: The Rings of Power",
      year: 2022,
      tmdb_id: tmdb?.id || null,
      media_type: "tv",
      watch_order: 7,
      poster_url: ropUrl,
      is_released: true
    }, { onConflict: "franchise_id,title" });
  }

  // Update total counts
  for (const fid of [screamId, fastId, meId]) {
      const { data: entries } = await supabase.from("franchise_entries").select("id").eq("franchise_id", fid);
      if (entries) {
          await supabase.from("franchise_collections").update({ total_entries: entries.length }).eq("id", fid);
      }
  }

  console.log("Finished all fixes.");
}

main().catch(console.error);
