import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BUCKET = "franchise-posters";
const REMOTE_PREFIX = "mcu/";
const LOCAL_DIR = path.resolve(__dirname, "../Marvel Cinematic Universe");

const MANUAL_UPLOADS = [
  { file: "Thunderbolts_ (2025).png", dbTitle: "Thunderbolts*", dbYear: 2025 },
  { file: "What If... (2021).jpg", dbTitle: "What If...?", dbYear: 2021 },
];

async function main() {
  for (const { file, dbTitle, dbYear } of MANUAL_UPLOADS) {
    const filePath = path.join(LOCAL_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${file}`);
      continue;
    }

    const ext = path.extname(file);
    const contentType = ext === ".png" ? "image/png" : "image/jpeg";
    const remotePath = `${REMOTE_PREFIX}${file}`;
    const fileBuffer = fs.readFileSync(filePath);

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(remotePath, fileBuffer, { contentType, upsert: true });

    if (uploadError) {
      console.log(`Upload failed for ${file}: ${uploadError.message}`);
      continue;
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(remotePath);

    // Find DB entry
    const { data: entry } = await supabase
      .from("franchise_entries")
      .select("id")
      .eq("title", dbTitle)
      .eq("year", dbYear)
      .single();

    if (!entry) {
      console.log(`No DB entry for ${dbTitle} (${dbYear})`);
      continue;
    }

    const { error: updateError } = await supabase
      .from("franchise_entries")
      .update({ poster_url: urlData.publicUrl })
      .eq("id", entry.id);

    if (updateError) {
      console.log(`DB update failed: ${updateError.message}`);
    } else {
      console.log(`✓ ${file} → ${dbTitle} (${dbYear})`);
    }
  }

  // Also upload the .webp franchise logo if it exists
  const webpLogo = "marvel cinematic universe.webp";
  const webpPath = path.join(LOCAL_DIR, webpLogo);
  if (fs.existsSync(webpPath)) {
    const remotePath = `${REMOTE_PREFIX}${webpLogo}`;
    const fileBuffer = fs.readFileSync(webpPath);

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(remotePath, fileBuffer, { contentType: "image/webp", upsert: true });

    if (error) {
      console.log(`Logo webp upload failed: ${error.message}`);
    } else {
      console.log(`✓ Uploaded ${webpLogo}`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
