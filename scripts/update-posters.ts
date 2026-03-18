import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function createSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ə/g, "a")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uploadFile(
  filePath: string,
  bucket: string,
  destination: string
): Promise<string | null> {
  const fileContent = fs.readFileSync(filePath);
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(destination, fileContent, { upsert: true });

  if (error) {
    console.warn(`Failed to upload ${filePath}: ${error.message}`);
    return null;
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(destination);

  return publicUrlData.publicUrl;
}

async function main() {
  const moviesToUpdate = [
    { title: "Arvadım mənim, uşaqlarım mənim", year: 1978, folder: "Arvadım mənim, uşaqlarım mənim (1978)" },
    { title: "Fəryad", year: 1993, folder: "Fəryad (1993)" },
    { title: "Gəmi saatının sirri", year: 1983, folder: "Gəmi saatının sirri (1983)" },
    { title: "Qara Volqa", year: 1994, folder: "Qara Volqa (1994)" },
    { title: "Özgə ömür", year: 1987, folder: "Özgə ömür (1987)" }
  ];

  const classicsDir = path.join(process.cwd(), "Classic Azerbaijan movies");

  for (const movie of moviesToUpdate) {
    const moviePath = path.join(classicsDir, movie.folder);
    const posterPath = path.join(moviePath, "poster.jpg");
    const posterWebpPath = path.join(moviePath, "poster.webp");

    let posterUrl: string | null = null;
    let actualPath = "";
    let extension = "";

    if (fs.existsSync(posterPath)) {
      actualPath = posterPath;
      extension = "jpg";
    } else if (fs.existsSync(posterWebpPath)) {
      actualPath = posterWebpPath;
      extension = "webp";
    }

    if (actualPath) {
      const slug = createSlug(movie.title);
      posterUrl = await uploadFile(actualPath, "az-classics", `posters/${slug}.${extension}`);
      
      if (posterUrl) {
        const { error } = await supabase
          .from("az_classic_movies")
          .update({ poster_url: posterUrl })
          .eq("title", movie.title)
          .eq("year", movie.year);

        if (error) {
          console.error(`- Failed to update ${movie.title}: ${error.message}`);
        } else {
          console.log(`- Successfully updated poster for: ${movie.title}`);
        }
      }
    } else {
        console.warn(`- No poster found in folder: ${movie.folder}`);
    }
  }

  console.log("\n✅ Update complete!");
}

main().catch(console.error);
