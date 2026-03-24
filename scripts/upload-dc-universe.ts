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
const COLLECTION_DIR = path.resolve(__dirname, "../posters/DC universe");
const COLLECTION_SLUG = "dc-universe";
const COLLECTION_TITLE = "DC Universe Collection";

type ParsedPoster = {
  file: string;
  title: string;
  year: number;
};

function toContentType(extension: string) {
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

function cleanRemoteFileName(fileName: string) {
  return fileName.replace(/[^a-z0-9. \-\(\)_']/gi, "_");
}

function parsePosterFile(file: string): ParsedPoster | null {
  const match = file.match(/^(.+?)\s*\((\d{4})\)\.[a-z0-9]+$/i);
  if (!match) {
    return null;
  }

  return {
    file,
    title: match[1].trim(),
    year: Number(match[2]),
  };
}

function normalizeSearchTitle(title: string) {
  return title
    .replace(/-/g, ":")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchTmdbMovie(title: string, year: number) {
  const searchCandidates = [
    title,
    normalizeSearchTitle(title),
    title.replace(/[:']/g, ""),
    normalizeSearchTitle(title).replace(/[:']/g, ""),
  ].filter((value, index, list) => value.length > 0 && list.indexOf(value) === index);

  for (const candidate of searchCandidates) {
    try {
      const url = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(candidate)}&primary_release_year=${year}&language=en-US`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
          accept: "application/json",
        },
      });

      const payload = await response.json();
      if (Array.isArray(payload.results) && payload.results.length > 0) {
        return payload.results[0];
      }
    } catch (error) {
      console.warn(`TMDB search failed for ${candidate} (${year})`, error);
    }
  }

  return null;
}

async function fetchTmdbDetails(tmdbId: number) {
  try {
    const response = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?language=en-US`, {
      headers: {
        Authorization: `Bearer ${TMDB_ACCESS_TOKEN}`,
        accept: "application/json",
      },
    });

    return await response.json();
  } catch (error) {
    console.warn(`TMDB details failed for ${tmdbId}`, error);
    return null;
  }
}

async function uploadFile(remotePath: string, localPath: string) {
  const extension = path.extname(localPath);
  const fileBuffer = fs.readFileSync(localPath);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { error } = await supabase.storage.from(BUCKET).upload(remotePath, fileBuffer, {
      upsert: true,
      contentType: toContentType(extension),
    });

    if (!error) {
      return supabase.storage.from(BUCKET).getPublicUrl(remotePath).data.publicUrl;
    }

    lastError = error;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Upload failed for ${remotePath}: ${message}`);
}

async function resolveSortOrder() {
  const { data, error } = await supabase
    .from("franchise_collections")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to resolve sort order: ${error.message}`);
  }

  return ((data && data[0]?.sort_order) || 0) + 1;
}

async function ensureCollection() {
  const sortOrder = await resolveSortOrder();
  const { data, error } = await supabase
    .from("franchise_collections")
    .upsert(
      {
        slug: COLLECTION_SLUG,
        title: COLLECTION_TITLE,
        total_entries: 0,
        is_active: true,
        sort_order: sortOrder,
      },
      { onConflict: "slug" }
    )
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create/update collection: ${error?.message ?? "unknown error"}`);
  }

  return data;
}

async function main() {
  if (!fs.existsSync(COLLECTION_DIR)) {
    throw new Error(`Collection directory not found: ${COLLECTION_DIR}`);
  }

  const files = fs.readdirSync(COLLECTION_DIR).filter((file) => /\.(png|jpe?g|webp)$/i.test(file));
  const logoFile = files.find((file) => !file.includes("("));
  const posters = files
    .map(parsePosterFile)
    .filter((item): item is ParsedPoster => Boolean(item))
    .sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

  if (!logoFile) {
    throw new Error("No logo file found for DC Universe collection.");
  }

  if (posters.length === 0) {
    throw new Error("No poster files found for DC Universe collection.");
  }

  const collection = await ensureCollection();
  console.log(`Collection ready: ${collection.title} (${collection.id})`);

  const logoRemotePath = `${COLLECTION_SLUG}/logo${path.extname(logoFile).toLowerCase()}`;
  const logoUrl = await uploadFile(logoRemotePath, path.join(COLLECTION_DIR, logoFile));
  await supabase.from("franchise_collections").update({ logo_url: logoUrl }).eq("id", collection.id);
  console.log("Logo uploaded.");

  let watchOrder = 1;
  for (const poster of posters) {
    console.log(`Processing ${poster.title} (${poster.year})`);

    const tmdbMovie = await fetchTmdbMovie(poster.title, poster.year);
    const details = tmdbMovie?.id ? await fetchTmdbDetails(tmdbMovie.id) : null;

    const entryPayload = {
      franchise_id: collection.id,
      tmdb_id: tmdbMovie?.id ?? null,
      media_type: "movie",
      title: poster.title,
      year: poster.year,
      watch_order: watchOrder,
      runtime_minutes: typeof details?.runtime === "number" ? details.runtime : null,
      tagline: typeof details?.tagline === "string" && details.tagline.length > 0 ? details.tagline : null,
      note: typeof details?.overview === "string" && details.overview.length > 0
        ? details.overview.slice(0, 200)
        : null,
      is_released: poster.year <= new Date().getFullYear(),
    };

    const { data: existingEntry, error: existingEntryError } = await supabase
      .from("franchise_entries")
      .select("id")
      .eq("franchise_id", collection.id)
      .eq("title", poster.title)
      .maybeSingle();

    if (existingEntryError) {
      throw new Error(`Failed to look up ${poster.title}: ${existingEntryError.message}`);
    }

    if (existingEntry?.id) {
      const { error: updateError } = await supabase
        .from("franchise_entries")
        .update(entryPayload)
        .eq("id", existingEntry.id);

      if (updateError) {
        throw new Error(`Failed to update ${poster.title}: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await supabase
        .from("franchise_entries")
        .insert(entryPayload);

      if (insertError) {
        throw new Error(`Failed to insert ${poster.title}: ${insertError.message}`);
      }
    }

    const remoteFileName = cleanRemoteFileName(poster.file);
    const posterRemotePath = `${COLLECTION_SLUG}/${remoteFileName}`;
    const posterUrl = await uploadFile(posterRemotePath, path.join(COLLECTION_DIR, poster.file));

    const { error: posterUpdateError } = await supabase
      .from("franchise_entries")
      .update({ poster_url: posterUrl, watch_order: watchOrder })
      .match({ franchise_id: collection.id, title: poster.title });

    if (posterUpdateError) {
      throw new Error(`Failed to update poster URL for ${poster.title}: ${posterUpdateError.message}`);
    }

    console.log(`Uploaded ${poster.title}${tmdbMovie?.id ? " with TMDB match" : " without TMDB match"}.`);
    watchOrder += 1;
  }

  await supabase
    .from("franchise_collections")
    .update({ total_entries: posters.length, title: COLLECTION_TITLE })
    .eq("id", collection.id);

  console.log(`DC Universe import complete. ${posters.length} entries uploaded.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
