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

async function main() {
  const file = "The Guardians of the Galaxy Holiday Special (2022).jpg";
  const dbTitle = "The Guardians of the Galaxy Holiday Special";
  const dbYear = 2022;

  const filePath = path.join(LOCAL_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${file}`);
    return;
  }

  const fileBuffer = fs.readFileSync(filePath);
  const remotePath = `${REMOTE_PREFIX}${file}`;

  console.log(`Uploading ${file}...`);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(remotePath, fileBuffer, { contentType: "image/jpeg", upsert: true });

  if (uploadError) {
    console.log(`Upload failed: ${uploadError.message}`);
    return;
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(remotePath);

  console.log(`Updating DB entry for "${dbTitle}"...`);
  const { error: updateError } = await supabase
    .from("franchise_entries")
    .update({ poster_url: urlData.publicUrl })
    .eq("title", dbTitle);

  if (updateError) {
    console.log(`DB update failed: ${updateError.message}`);
  } else {
    console.log(`✓ DB updated: ${urlData.publicUrl}`);
  }
}

main().catch(console.error);
