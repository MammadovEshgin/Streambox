import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("Missing Supabase credentials in environment.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const desiredOrder = [
  { slug: "marvel-cinematic-universe", sortOrder: 1, title: "MCU collection" },
  { slug: "dc-universe", sortOrder: 2, title: "Dc collection" },
  { slug: "x-men-collection", sortOrder: 3 },
  { slug: "star-wars-collection", sortOrder: 4 },
  { slug: "harry-potter-collection", sortOrder: 5 },
  { slug: "middle-earth-collection", sortOrder: 6 },
  { slug: "james-bond-collection", sortOrder: 7 },
  { slug: "mission-impossible-collection", sortOrder: 8 },
  { slug: "the-fast-and-the-furious-collection", sortOrder: 9 },
  { slug: "transformers-collection", sortOrder: 10 },
  { slug: "jurassic-park-collection", sortOrder: 11 },
  { slug: "the-twilight-collection", sortOrder: 12 },
  { slug: "rocky-collection", sortOrder: 13 },
  { slug: "john-wick-collection", sortOrder: 14 },
  { slug: "the-bourne-collection", sortOrder: 15 },
  { slug: "dune-collection", sortOrder: 16 },
  { slug: "indiana-jones-collection", sortOrder: 17 },
  { slug: "the-hunger-games-collection", sortOrder: 18 },
  { slug: "saw-collection", sortOrder: 19 },
  { slug: "scream-collection", sortOrder: 20 },
  { slug: "the-conjuring-collection", sortOrder: 21 },
  { slug: "insidious-collection", sortOrder: 22 },
];

async function main() {
  const { data: collections, error } = await supabase
    .from("franchise_collections")
    .select("id, slug, title, sort_order");

  if (error || !collections) {
    throw new Error(`Failed to load franchise collections: ${error?.message ?? "unknown error"}`);
  }

  const desiredBySlug = new Map(desiredOrder.map((item) => [item.slug, item]));

  for (const item of desiredOrder) {
    const { error: updateError } = await supabase
      .from("franchise_collections")
      .update({
        sort_order: item.sortOrder,
        ...(item.title ? { title: item.title } : {}),
      })
      .eq("slug", item.slug);

    if (updateError) {
      throw new Error(`Failed to update ${item.slug}: ${updateError.message}`);
    }
  }

  let nextSortOrder = desiredOrder.length + 1;
  for (const collection of collections) {
    if (desiredBySlug.has(collection.slug)) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("franchise_collections")
      .update({ sort_order: nextSortOrder })
      .eq("id", collection.id);

    if (updateError) {
      throw new Error(`Failed to move ${collection.slug} to ${nextSortOrder}: ${updateError.message}`);
    }

    nextSortOrder += 1;
  }

  const { data: finalCollections, error: finalError } = await supabase
    .from("franchise_collections")
    .select("slug, title, sort_order")
    .order("sort_order", { ascending: true });

  if (finalError) {
    throw new Error(`Failed to verify final order: ${finalError.message}`);
  }

  for (const row of finalCollections || []) {
    console.log(`${row.sort_order}. ${row.title} (${row.slug})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
