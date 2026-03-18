import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const CLASSICS_DIR = path.join(process.cwd(), "Classic Azerbaijan movies");
const BUCKET_NAME = "az-classics";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type PersonRow = {
  id: string;
  name: string;
  photo_url: string | null;
};

type MovieRow = {
  id: string;
  title: string;
  year: number;
};

function parseMovieFolderName(folderName: string) {
  const match = folderName.match(/^(.*)\s+\((\d{4})\)$/);
  if (!match) {
    return null;
  }

  return {
    title: match[1].trim(),
    year: Number(match[2]),
  };
}

function normalizeName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/ə/g, "a")
    .replace(/Ə/g, "a")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ğ/g, "gh")
    .replace(/Ğ/g, "gh")
    .replace(/ş/g, "sh")
    .replace(/Ş/g, "sh")
    .replace(/ç/g, "ch")
    .replace(/Ç/g, "ch")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "u")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.(jpg|jpeg|png|webp)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNameKeys(value: string) {
  const baseKey = normalizeName(value);
  const compactKey = baseKey.replace(/\s+/g, "");
  const softenedKey = baseKey
    .replace(/\bgh/g, "g")
    .replace(/gh/g, "g")
    .replace(/\bsh/g, "s")
    .replace(/sh/g, "s")
    .replace(/\bch/g, "c")
    .replace(/ch/g, "c");

  return [...new Set([baseKey, compactKey, softenedKey, softenedKey.replace(/\s+/g, "")])];
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/ə/g, "e")
    .replace(/Ə/g, "e")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "g")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "c")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "u")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getImageFilesByName(movieDir: string) {
  const files = fs.readdirSync(movieDir, { withFileTypes: true });
  const imageFiles = files
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    .filter((fileName) => !/^poster\./i.test(fileName));

  return imageFiles.reduce<Map<string, string>>((lookup, fileName) => {
    const fullPath = path.join(movieDir, fileName);
    buildNameKeys(fileName).forEach((key) => {
      if (!lookup.has(key)) {
        lookup.set(key, fullPath);
      }
    });
    return lookup;
  }, new Map());
}

async function findMovie(title: string, year: number): Promise<MovieRow | null> {
  const { data, error } = await supabase
    .from("az_classic_movies")
    .select("id, title, year")
    .eq("title", title)
    .eq("year", year)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load movie "${title}" (${year}): ${error.message}`);
  }

  return data;
}

async function loadPeople(tableName: "az_classic_cast" | "az_classic_crew", movieId: string): Promise<PersonRow[]> {
  const { data, error } = await supabase
    .from(tableName)
    .select("id, name, photo_url")
    .eq("movie_id", movieId)
    .order("display_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to load ${tableName} for movie ${movieId}: ${error.message}`);
  }

  return data || [];
}

async function uploadPhoto(localPath: string, storagePath: string) {
  const fileBuffer = fs.readFileSync(localPath);
  const extension = path.extname(localPath).toLowerCase();
  const contentType =
    extension === ".png" ? "image/png"
    : extension === ".webp" ? "image/webp"
    : "image/jpeg";

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, fileBuffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload ${localPath}: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function updatePhotoUrl(
  tableName: "az_classic_cast" | "az_classic_crew",
  rowId: string,
  photoUrl: string
) {
  const { error } = await supabase
    .from(tableName)
    .update({ photo_url: photoUrl })
    .eq("id", rowId);

  if (error) {
    throw new Error(`Failed to update ${tableName}.${rowId}: ${error.message}`);
  }
}

async function syncPeopleForMovie(
  movie: MovieRow,
  tableName: "az_classic_cast" | "az_classic_crew",
  imageLookup: Map<string, string>
) {
  const people = await loadPeople(tableName, movie.id);
  let updatedCount = 0;

  for (const person of people) {
    if (person.photo_url) {
      continue;
    }

    const localPath = buildNameKeys(person.name)
      .map((key) => imageLookup.get(key))
      .find((match): match is string => typeof match === "string");
    if (!localPath) {
      continue;
    }

    const extension = path.extname(localPath).toLowerCase();
    const collection = tableName === "az_classic_cast" ? "cast" : "crew";
    const storagePath = `people/${movie.id}/${collection}/${person.id}-${slugify(person.name)}${extension}`;
    const photoUrl = await uploadPhoto(localPath, storagePath);
    await updatePhotoUrl(tableName, person.id, photoUrl);
    updatedCount += 1;
    console.log(`  Updated ${tableName}: ${person.name}`);
  }

  return updatedCount;
}

async function main() {
  if (!fs.existsSync(CLASSICS_DIR)) {
    throw new Error(`Classic Azerbaijan movies directory not found: ${CLASSICS_DIR}`);
  }

  const movieFolders = fs.readdirSync(CLASSICS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  let updatedCastCount = 0;
  let updatedCrewCount = 0;
  let skippedMovies = 0;

  for (const folder of movieFolders) {
    const parsedFolder = parseMovieFolderName(folder.name);
    if (!parsedFolder) {
      console.warn(`Skipping folder with unexpected name format: ${folder.name}`);
      skippedMovies += 1;
      continue;
    }

    const movie = await findMovie(parsedFolder.title, parsedFolder.year);
    if (!movie) {
      console.warn(`Movie not found in Supabase: ${parsedFolder.title} (${parsedFolder.year})`);
      skippedMovies += 1;
      continue;
    }

    const movieDir = path.join(CLASSICS_DIR, folder.name);
    const imageLookup = getImageFilesByName(movieDir);
    if (imageLookup.size === 0) {
      continue;
    }

    console.log(`Checking ${movie.title} (${movie.year})`);
    updatedCastCount += await syncPeopleForMovie(movie, "az_classic_cast", imageLookup);
    updatedCrewCount += await syncPeopleForMovie(movie, "az_classic_crew", imageLookup);
  }

  console.log("");
  console.log(`Completed. Updated cast photos: ${updatedCastCount}`);
  console.log(`Completed. Updated crew photos: ${updatedCrewCount}`);
  console.log(`Skipped movies: ${skippedMovies}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
