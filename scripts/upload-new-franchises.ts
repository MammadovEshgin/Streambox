import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
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
const BUCKET = "franchise-posters";
const POSTERS_DIR = path.resolve(__dirname, "../posters");

async function fetchTmdbMovie(title: string, year: number) {
  try {
    const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(
      title
    )}&primary_release_year=${year}&language=en-US`;
    
    // Sometimes TMDB has slight variations in titles, stripping punct can help
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
        accept: "application/json",
      },
    });
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      // Find exact or closest match. In this case, first result with matching year is usually correct
      return data.results[0];
    }
  } catch (error) {
    console.error(`TMDB search failed for ${title} (${year}):`, error);
  }
  return null;
}

async function fetchTmdbDetails(tmdbId: number) {
  try {
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?language=en-US`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
        accept: "application/json",
      },
    });
    return await res.json();
  } catch (error) {
    console.error(`TMDB details failed for ${tmdbId}:`, error);
  }
  return null;
}

function generateSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function main() {
  const dirs = fs.readdirSync(POSTERS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== "Marvel Cinematic Universe");

  // Determine the next sort_order for new collections
  const { data: colData } = await supabase
    .from("franchise_collections")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
    
  let currentSortOrder = (colData && colData.length > 0 ? colData[0].sort_order : 0) + 1;

  for (const dir of dirs) {
    const dirName = dir.name;
    // e.g. "Harry Potter Collection set by M9D4 - 2026-03-17" -> "Harry Potter Collection"
    const collectionTitleMatch = dirName.match(/^(.+?)(?:\s+set by.*)?$/i);
    const collectionTitle = collectionTitleMatch ? collectionTitleMatch[1].trim() : dirName;
    const slug = generateSlug(collectionTitle);
    
    console.log(`\n=== Processing: ${collectionTitle} ===`);
    
    const dirPath = path.join(POSTERS_DIR, dirName);
    const files = fs.readdirSync(dirPath).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
    
    let logoFile = files.find(f => !f.includes("(") && f.toLowerCase().includes(collectionTitle.toLowerCase()));
    if (!logoFile) {
        // Fallback: the shortest filename without parentheses
        logoFile = files.find(f => !f.includes("("));
    }

    const movieFiles = files.filter(f => f !== logoFile);
    
    // Sort movies by year from filename "(YYYY)"
    const parsedMovies = movieFiles.map(f => {
      const match = f.match(/^(.+?)\s*\((\d{4})\)\.[a-z0-9]+$/i);
      if (!match) return { file: f, title: path.parse(f).name, year: 2000 }; // fallback
      return { file: f, title: match[1].trim(), year: parseInt(match[2], 10) };
    });
    
    parsedMovies.sort((a, b) => a.year - b.year);
    
    // Upsert Franchise Collection
    const { data: collection, error: collError } = await supabase
      .from("franchise_collections")
      .upsert({
        slug,
        title: collectionTitle,
        total_entries: parsedMovies.length,
        is_active: true,
        sort_order: currentSortOrder,
      }, { onConflict: "slug" })
      .select()
      .single();
      
    if (collError || !collection) {
      console.error(`Failed to insert collection ${collectionTitle}:`, collError?.message);
      continue;
    }
    
    currentSortOrder++;
    
    // Upload Logo
    if (logoFile) {
      const ext = path.extname(logoFile);
      const remotePath = `${slug}/logo${ext}`;
      const fileBuffer = fs.readFileSync(path.join(dirPath, logoFile));
      
      const { error: logoUploadError } = await supabase.storage
        .from(BUCKET)
        .upload(remotePath, fileBuffer, { upsert: true, contentType: ext === '.png' ? 'image/png' : 'image/jpeg' });
        
      if (!logoUploadError) {
        const { data: logoUrlData } = supabase.storage.from(BUCKET).getPublicUrl(remotePath);
        await supabase.from("franchise_collections").update({ logo_url: logoUrlData.publicUrl }).eq("id", collection.id);
        console.log(`Logo uploaded for ${collectionTitle}`);
      }
    }
    
    // Process Movies
    let watchOrder = 1;
    for (const movie of parsedMovies) {
      console.log(`  Processing: ${movie.title} (${movie.year})`);
      
      // 1. Fetch TMDB Data
      const tmdbMovie = await fetchTmdbMovie(movie.title, movie.year);
      let tmdbId = null;
      let runtimeMinutes = null;
      let tagline = null;
      let overview = null;
      
      if (tmdbMovie) {
        tmdbId = tmdbMovie.id;
        const details = await fetchTmdbDetails(tmdbId);
        if (details) {
          runtimeMinutes = details.runtime;
          tagline = details.tagline;
          overview = details.overview;
        }
      } else {
        console.log(`    ! TMDB not found for ${movie.title}`);
      }
      
      // 2. Insert DB Entry (without poster_url first)
      const { data: entry, error: entryError } = await supabase
        .from("franchise_entries")
        .upsert({
          franchise_id: collection.id,
          tmdb_id: tmdbId,
          media_type: "movie",
          title: movie.title,
          year: movie.year,
          watch_order: watchOrder,
          runtime_minutes: runtimeMinutes,
          tagline: tagline,
          note: overview ? (overview.length > 200 ? overview.substring(0, 197) + "..." : overview) : null,
          is_released: true
        }, { onConflict: "franchise_id,title" }) // Note: might need to adjust onConflict if not properly indexed
        .select()
        .single();
        
      if (entryError) {
        // Fallback: If no unique index on franchise_id+title, use standard insert and delete old ones
        // Since we don't know the exact unique constraint, let's just delete existing by title and insert
        await supabase.from("franchise_entries").delete().eq("franchise_id", collection.id).eq("title", movie.title);
        
        const { data: newEntry, error: insertError } = await supabase
          .from("franchise_entries")
          .insert({
            franchise_id: collection.id,
            tmdb_id: tmdbId,
            media_type: "movie",
            title: movie.title,
            year: movie.year,
            watch_order: watchOrder,
            runtime_minutes: runtimeMinutes,
            tagline: tagline,
            note: overview ? (overview.length > 200 ? overview.substring(0, 197) + "..." : overview) : null,
            is_released: true
          })
          .select()
          .single();
          
        if (insertError) {
           console.error(`    ✗ DB insert failed for ${movie.title}:`, insertError.message);
           watchOrder++;
           continue;
        }
      }
      
      // 3. Upload Poster
      const ext = path.extname(movie.file);
      // Construct remote path properly preserving the filename, inside a folder
      const cleanFileName = movie.file.replace(/[^a-z0-9. \-\(\)_]/gi, '_');
      const remotePath = `${slug}/${cleanFileName}`;
      const fileBuffer = fs.readFileSync(path.join(dirPath, movie.file));
      
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(remotePath, fileBuffer, { upsert: true, contentType: ext === '.png' ? 'image/png' : 'image/jpeg' });
        
      if (uploadError) {
        console.error(`    ✗ Poster upload failed for ${movie.title}:`, uploadError.message);
      } else {
        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(remotePath);
        
        // 4. Update the DB with the poster_url
        await supabase
          .from("franchise_entries")
          .update({ poster_url: urlData.publicUrl })
          // We can use the title and franchise_id since we just inserted it
          .match({ franchise_id: collection.id, title: movie.title });
          
        console.log(`    ✓ Done (${tmdbId ? 'TMDB matched' : 'No TMDB'})`);
      }
      
      watchOrder++;
    }
  }
  console.log("\n=== Finished Franchise Processing ===");
}

main().catch(console.error);
