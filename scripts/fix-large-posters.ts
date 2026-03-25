import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const BUCKET = "franchise-posters";

const TARGETS = [
  { file: "posters/Middle-Earth Collection set by mikenobbs - 2026-03-17/Middle-Earth Collection.png", isLogo: true, slug: "middle-earth-collection" },
  { file: "posters/Middle-Earth Collection set by mikenobbs - 2026-03-17/The Hobbit An Unexpected Journey (2012).png", title: "The Hobbit An Unexpected Journey", slug: "middle-earth-collection" },
  { file: "posters/Middle-Earth Collection set by mikenobbs - 2026-03-17/The Hobbit The Desolation of Smaug (2013).png", title: "The Hobbit The Desolation of Smaug", slug: "middle-earth-collection" },
  { file: "posters/Middle-Earth Collection set by mikenobbs - 2026-03-17/The Hobbit The Battle of the Five Armies (2014).png", title: "The Hobbit The Battle of the Five Armies", slug: "middle-earth-collection" },
  { file: "posters/Middle-Earth Collection set by mikenobbs - 2026-03-17/The Lord of the Rings The Fellowship of the Ring (2001).png", title: "The Lord of the Rings The Fellowship of the Ring", slug: "middle-earth-collection" },
  { file: "posters/Middle-Earth Collection set by mikenobbs - 2026-03-17/The Lord of the Rings The Two Towers (2002).png", title: "The Lord of the Rings The Two Towers", slug: "middle-earth-collection" },
  { file: "posters/Middle-Earth Collection set by mikenobbs - 2026-03-17/The Lord of the Rings The Return of the King (2003).png", title: "The Lord of the Rings The Return of the King", slug: "middle-earth-collection" },
  { file: "posters/Star Wars Collection set by Jendo7 - 2026-03-17/Star Wars The Force Awakens (2015).png", title: "Star Wars The Force Awakens", slug: "star-wars-collection" },
];

async function main() {
  for (const target of TARGETS) {
    const filePath = path.resolve(__dirname, "..", target.file);
    if (!fs.existsSync(filePath)) {
      console.log(`Missing: ${filePath}`);
      continue;
    }

    const ext = path.extname(target.file);
    const basename = path.basename(target.file).replace(/[^a-z0-9. \-\(\)_]/gi, '_');
    const remotePath = target.isLogo 
      ? `${target.slug}/logo${ext}` 
      : `${target.slug}/${basename}`;

    console.log(`Uploading ${basename}...`);
    const fileBuffer = fs.readFileSync(filePath);
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(remotePath, fileBuffer, {
        upsert: true,
        contentType: ext.toLowerCase() === ".png" ? "image/png" : "image/jpeg"
      });

    if (uploadError) {
      console.error(`  Upload failed: ${uploadError.message}`);
      continue;
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(remotePath);

    if (target.isLogo) {
      const { error } = await supabase
        .from("franchise_collections")
        .update({ logo_url: urlData.publicUrl })
        .eq("slug", target.slug);
      console.log(`  Logo DB Update: ${error ? error.message : "Success"}`);
    } else {
      const { error } = await supabase
        .from("franchise_entries")
        .update({ poster_url: urlData.publicUrl })
        .eq("title", target.title);
      console.log(`  Poster DB Update for ${target.title}: ${error ? error.message : "Success"}`);
    }
  }
}

main().catch(console.error);
