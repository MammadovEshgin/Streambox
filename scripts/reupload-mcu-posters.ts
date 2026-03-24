import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BUCKET = "franchise-posters";
const REMOTE_PREFIX = "mcu/";
const LOCAL_POSTER_DIR = path.resolve(__dirname, "../Marvel Cinematic Universe");

// Map: local filename -> DB title+year for matching
// The local files are named like "Iron Man (2008).jpg"
// The DB has title like "Iron Man" and year 2008

function getContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

async function main() {
  console.log("=== MCU Poster Re-upload Script ===\n");

  // 1. List and delete all old files in mcu/
  console.log("1. Listing old files in storage...");
  const { data: oldFiles, error: listError } = await supabase.storage
    .from(BUCKET)
    .list(REMOTE_PREFIX.replace(/\/$/, ""), { limit: 200 });

  if (listError) {
    console.error("Error listing files:", listError.message);
  } else if (oldFiles && oldFiles.length > 0) {
    const oldPaths = oldFiles.map((f) => `${REMOTE_PREFIX}${f.name}`);
    console.log(`   Found ${oldPaths.length} old files. Deleting...`);

    const { error: deleteError } = await supabase.storage.from(BUCKET).remove(oldPaths);
    if (deleteError) {
      console.error("Error deleting old files:", deleteError.message);
    } else {
      console.log(`   ✓ Deleted ${oldPaths.length} old files\n`);
    }
  } else {
    console.log("   No old files found.\n");
  }

  // 2. Get all entries from DB
  console.log("2. Fetching franchise entries from DB...");
  const { data: entries, error: entriesError } = await supabase
    .from("franchise_entries")
    .select("id, title, year")
    .order("watch_order");

  if (entriesError || !entries) {
    console.error("Error fetching entries:", entriesError?.message);
    process.exit(1);
  }
  console.log(`   Found ${entries.length} entries\n`);

  // 3. Get all local files
  const localFiles = fs.readdirSync(LOCAL_POSTER_DIR).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
  });
  console.log(`3. Found ${localFiles.length} local poster files\n`);

  // 4. Upload each file and build URL mapping
  console.log("4. Uploading new posters...");
  let uploaded = 0;
  let skipped = 0;
  const updateQueries: Array<{ id: string; poster_url: string }> = [];

  // Also handle the franchise logo
  const logoFile = localFiles.find(
    (f) => f.toLowerCase().startsWith("marvel cinematic universe") && !f.toLowerCase().includes("(")
  );

  for (const file of localFiles) {
    // Skip the franchise collection logo — handle separately
    if (file.toLowerCase().startsWith("marvel cinematic universe") && !file.includes("(")) {
      continue;
    }

    const ext = path.extname(file);
    const baseName = path.basename(file, ext);

    // Parse: "Iron Man (2008)" -> title="Iron Man", year=2008
    const match = baseName.match(/^(.+?)\s*\((\d{4})\)$/);
    if (!match) {
      console.log(`   ⊘ Skipping (no year match): ${file}`);
      skipped++;
      continue;
    }

    const localTitle = match[1].trim();
    const localYear = parseInt(match[2], 10);

    // Find matching DB entry
    const dbEntry = entries.find((e) => {
      // Normalize: remove colons, dashes from both for comparison
      const normalize = (s: string) =>
        s
          .replace(/[:\-–—]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      return normalize(e.title) === normalize(localTitle) && e.year === localYear;
    });

    if (!dbEntry) {
      console.log(`   ⊘ No DB match for: ${file} (title="${localTitle}", year=${localYear})`);
      skipped++;
      continue;
    }

    // Upload
    const remotePath = `${REMOTE_PREFIX}${file}`;
    const fileBuffer = fs.readFileSync(path.join(LOCAL_POSTER_DIR, file));
    const contentType = getContentType(ext);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(remotePath, fileBuffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.log(`   ✗ Upload failed: ${file} — ${uploadError.message}`);
      continue;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(remotePath);

    updateQueries.push({
      id: dbEntry.id,
      poster_url: urlData.publicUrl,
    });

    uploaded++;
    console.log(`   ✓ [${uploaded}] ${file} → ${dbEntry.title}`);
  }

  // Upload franchise logo
  if (logoFile) {
    const ext = path.extname(logoFile);
    const remotePath = `${REMOTE_PREFIX}${logoFile}`;
    const fileBuffer = fs.readFileSync(path.join(LOCAL_POSTER_DIR, logoFile));
    const contentType = getContentType(ext);

    const { error: logoUploadError } = await supabase.storage
      .from(BUCKET)
      .upload(remotePath, fileBuffer, { contentType, upsert: true });

    if (logoUploadError) {
      console.log(`   ✗ Logo upload failed: ${logoFile} — ${logoUploadError.message}`);
    } else {
      const { data: logoUrlData } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(remotePath);

      // Update franchise_collections logo_url
      const { error: logoDbError } = await supabase
        .from("franchise_collections")
        .update({ logo_url: logoUrlData.publicUrl })
        .eq("slug", "mcu");

      if (logoDbError) {
        console.log(`   ✗ Logo DB update failed: ${logoDbError.message}`);
      } else {
        console.log(`   ✓ Logo uploaded: ${logoFile}`);
      }
    }
  }

  console.log(`\n   Uploaded: ${uploaded}, Skipped: ${skipped}\n`);

  // 5. Update DB poster_url for each entry
  console.log("5. Updating poster URLs in database...");
  let dbUpdated = 0;
  for (const { id, poster_url } of updateQueries) {
    const { error: updateError } = await supabase
      .from("franchise_entries")
      .update({ poster_url })
      .eq("id", id);

    if (updateError) {
      console.log(`   ✗ DB update failed for ${id}: ${updateError.message}`);
    } else {
      dbUpdated++;
    }
  }

  console.log(`   ✓ Updated ${dbUpdated} entries in database\n`);
  console.log("=== Done! ===");
}

main().catch(console.error);
