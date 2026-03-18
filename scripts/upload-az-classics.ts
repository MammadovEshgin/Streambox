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

interface MovieMetadata {
  title: string;
  year: number;
  synopsis: string;
  genre: string;
  cast: Array<{ name: string; character: string }>;
  crew: Array<{ name: string; role: string }>;
}

function parseMovieInfo(content: string): MovieMetadata | null {
  const titleMatch = content.match(/^#\s+(.+?)\s+\((\d{4})\)/m);
  if (!titleMatch) return null;

  const title = titleMatch[1];
  const year = parseInt(titleMatch[2], 10);

  const synopsisMatch = content.match(/##\s+Synopsis\s+([\s\S]*?)##\s+Genre/);
  const synopsis = synopsisMatch ? synopsisMatch[1].trim() : "";

  const genreMatch = content.match(/##\s+Genre\s+([\s\S]*?)##\s+(?:Crew|Cast)/);
  const genre = genreMatch ? genreMatch[1].trim() : "";

  const castMatch = content.match(/##\s+Cast\s+([\s\S]*?)(?:##|$)/);
  const crewMatch = content.match(/##\s+Crew\s+([\s\S]*?)##\s+Cast/);

  const cast = castMatch
    ? castMatch[1]
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          // Handle both "**Name** as CHAR" and "Name (CHAR)" formats
          let match = line.match(/\*\*([^*]+)\*\*\s+as\s+(.+)/);
          if (match) {
            return { name: match[1].trim(), character: match[2].trim() };
          }

          match = line.match(/^-?\s*([^()]+)\s*\(([^)]+)\)\s*$/);
          if (match) {
            return { name: match[1].trim(), character: match[2].trim() };
          }

          return null;
        })
        .filter((x): x is { name: string; character: string } => x !== null)
    : [];

  const crew = crewMatch
    ? crewMatch[1]
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const match = line.match(/\*\*([^*]+)\*\*\s*\(([^)]+)\)/);
          if (match) {
            return { name: match[1].trim(), role: match[2].trim() };
          }
          return null;
        })
        .filter((x): x is { name: string; role: string } => x !== null)
    : [];

  return { title, year, synopsis, genre, cast, crew };
}

function getCrewDisplayOrder(role: string): number {
  const roleMap: Record<string, number> = {
    "REJİSSOR": 1,
    "SSENARİ MÜƏLLİFİ": 2,
    "OPERATOR": 3,
    "BƏSTƏKAR": 4,
    "RƏSSAM": 5
  };
  return roleMap[role.toUpperCase()] ?? 999;
}

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
  try {
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
  } catch (error) {
    console.warn(`Error uploading ${filePath}:`, error);
    return null;
  }
}

async function main() {
  const classicsDir = path.join(process.cwd(), "Classic Azerbaijan movies");

  if (!fs.existsSync(classicsDir)) {
    console.error(`Classic Azerbaijan movies directory not found at: ${classicsDir}`);
    process.exit(1);
  }

  const movieDirs = fs
    .readdirSync(classicsDir)
    .filter((f) => fs.statSync(path.join(classicsDir, f)).isDirectory());

  console.log(`Found ${movieDirs.length} movie directories`);

  for (const movieDir of movieDirs) {
    const moviePath = path.join(classicsDir, movieDir);
    const infoPath = path.join(moviePath, "movie_info.md");

    if (!fs.existsSync(infoPath)) {
      console.warn(`Skipping ${movieDir}: no movie_info.md found`);
      continue;
    }

    const infoContent = fs.readFileSync(infoPath, "utf-8");
    const metadata = parseMovieInfo(infoContent);

    if (!metadata) {
      console.warn(`Failed to parse ${movieDir}`);
      continue;
    }

    console.log(`\nProcessing: ${metadata.title} (${metadata.year})`);

    // Upload poster
    let posterUrl: string | null = null;
    const posterPath = path.join(moviePath, "poster.jpg");
    const posterWebpPath = path.join(moviePath, "poster.webp");

    if (fs.existsSync(posterPath)) {
      const slug = createSlug(metadata.title);
      posterUrl = await uploadFile(posterPath, "az-classics", `posters/${slug}.jpg`);
    } else if (fs.existsSync(posterWebpPath)) {
      const slug = createSlug(metadata.title);
      posterUrl = await uploadFile(posterWebpPath, "az-classics", `posters/${slug}.webp`);
    } else {
      console.warn(`  - No poster found for ${metadata.title}`);
    }

    // Insert movie
    const { data: movieData, error: movieError } = await supabase
      .from("az_classic_movies")
      .insert({
        title: metadata.title,
        year: metadata.year,
        synopsis: metadata.synopsis || null,
        genre: metadata.genre || null,
        poster_url: posterUrl
      })
      .select("id")
      .single();

    if (movieError || !movieData) {
      console.error(`  - Failed to insert movie: ${movieError?.message}`);
      continue;
    }

    const movieId = movieData.id;
    console.log(`  - Movie inserted: ${movieId}`);

    // Upload cast photos and insert cast
    for (let i = 0; i < metadata.cast.length; i++) {
      const castMember = metadata.cast[i];
      let photoUrl: string | null = null;

      // Try to find photo file
      const photoFile = fs.readdirSync(moviePath).find((f) => {
        const baseName = f.replace(/\.(jpg|jpeg|webp|png)$/i, "");
        return baseName === castMember.name;
      });

      if (photoFile) {
        const photoPath = path.join(moviePath, photoFile);
        const slug = createSlug(castMember.name);
        photoUrl = await uploadFile(photoPath, "az-classics", `people/${slug}-${Date.now()}.jpg`);
      }

      await supabase.from("az_classic_cast").insert({
        movie_id: movieId,
        name: castMember.name,
        character: castMember.character,
        photo_url: photoUrl,
        display_order: i
      });
    }

    console.log(`  - ${metadata.cast.length} cast members inserted`);

    // Upload crew photos and insert crew
    const sortedCrew = [...metadata.crew].sort(
      (a, b) => getCrewDisplayOrder(a.role) - getCrewDisplayOrder(b.role)
    );

    for (let i = 0; i < sortedCrew.length; i++) {
      const crewMember = sortedCrew[i];
      let photoUrl: string | null = null;

      // Try to find photo file
      const photoFile = fs.readdirSync(moviePath).find((f) => {
        const baseName = f.replace(/\.(jpg|jpeg|webp|png)$/i, "");
        return baseName === crewMember.name;
      });

      if (photoFile) {
        const photoPath = path.join(moviePath, photoFile);
        const slug = createSlug(crewMember.name);
        photoUrl = await uploadFile(photoPath, "az-classics", `people/${slug}-${Date.now()}.jpg`);
      }

      await supabase.from("az_classic_crew").insert({
        movie_id: movieId,
        name: crewMember.name,
        role: crewMember.role,
        photo_url: photoUrl,
        display_order: i
      });
    }

    console.log(`  - ${sortedCrew.length} crew members inserted`);
  }

  console.log("\n✅ Upload complete!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
