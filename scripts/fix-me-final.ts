import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const ME_ID = '42b265ff-ef76-4285-bb84-49c40b056d49';
const BUCKET_URL = `${SUPABASE_URL}/storage/v1/object/public/franchise-posters`;
const RINGS_OF_POWER_TMDB_ID = 84773;
const RINGS_OF_POWER_TITLE = "The Lord of the Rings: The Rings of Power";

type FranchiseEntryRow = {
  id: string;
  title: string;
  tmdb_id: number | null;
};

async function main() {
  console.log("Fixing Middle-Earth Collection...");

  const { data: entries, error: entriesError } = await supabase
    .from("franchise_entries")
    .select("id, title, tmdb_id")
    .eq("franchise_id", ME_ID)
    .order("watch_order", { ascending: true });

  if (entriesError || !entries) {
    throw new Error(`Failed to load Middle-earth entries: ${entriesError?.message ?? "unknown error"}`);
  }

  // 1. Re-order Hobbit and LOTR entries.
  const updates = [
    { title: "The Hobbit An Unexpected Journey", order: 1 },
    { title: "The Hobbit The Desolation of Smaug", order: 2 },
    { title: "The Hobbit The Battle of the Five Armies", order: 3 },
    { title: "The Lord of the Rings The Fellowship of the Ring", order: 4 },
    { title: "The Lord of the Rings The Two Towers", order: 5 },
    { title: "The Lord of the Rings The Return of the King", order: 6 },
  ];

  for (const [index, u] of updates.entries()) {
    const match = (entries as FranchiseEntryRow[]).find((entry) => entry.title === u.title);
    if (!match) {
      console.warn(`Missing expected entry: ${u.title}`);
      continue;
    }

    const tempOrder = 100 + index;
    const { error } = await supabase.from("franchise_entries").update({ watch_order: tempOrder }).eq("id", match.id);
    if (error) {
      throw new Error(`Failed to assign temporary order for ${u.title}: ${error.message}`);
    }
  }

  for (const u of updates) {
    const match = (entries as FranchiseEntryRow[]).find((entry) => entry.title === u.title);
    if (!match) {
      continue;
    }

    const { error } = await supabase.from("franchise_entries").update({ watch_order: u.order }).eq("id", match.id);
    if (error) {
      throw new Error(`Failed to assign final order for ${u.title}: ${error.message}`);
    }
  }

  // 2. Ensure Rings of Power exists exactly once and has the correct poster.
  console.log("Normalizing Rings of Power entry...");
  const ropPoster = `${BUCKET_URL}/middle-earth-collection/The%20Lord%20of%20the%20Rings-%20The%20Rings%20of%20Power%20(2022).png`;

  const ringsMatches = (entries as FranchiseEntryRow[]).filter(
    (entry) => entry.tmdb_id === RINGS_OF_POWER_TMDB_ID || /rings of power/i.test(entry.title)
  );

  if (ringsMatches.length > 0) {
    const [primary, ...duplicates] = ringsMatches;

    const { error: updateError } = await supabase
      .from("franchise_entries")
      .update({
        title: RINGS_OF_POWER_TITLE,
        year: 2022,
        media_type: "tv",
        watch_order: 7,
        poster_url: ropPoster,
        is_released: true,
        tmdb_id: RINGS_OF_POWER_TMDB_ID,
      })
      .eq("id", primary.id);

    if (updateError) {
      throw new Error(`Failed to update Rings of Power: ${updateError.message}`);
    }

    if (duplicates.length > 0) {
      const duplicateIds = duplicates.map((entry) => entry.id);
      const { error: deleteError } = await supabase.from("franchise_entries").delete().in("id", duplicateIds);
      if (deleteError) {
        throw new Error(`Failed to remove duplicate Rings of Power rows: ${deleteError.message}`);
      }
    }
  } else {
    const { error: insertError } = await supabase.from("franchise_entries").insert({
      franchise_id: ME_ID,
      title: RINGS_OF_POWER_TITLE,
      year: 2022,
      media_type: "tv",
      watch_order: 7,
      poster_url: ropPoster,
      is_released: true,
      tmdb_id: RINGS_OF_POWER_TMDB_ID,
    });

    if (insertError) {
      throw new Error(`Failed to insert Rings of Power: ${insertError.message}`);
    }
  }

  // 3. Update Middle-earth total_entries so Discover reflects the new count.
  const { data: finalEntries, error: finalEntriesError } = await supabase
    .from("franchise_entries")
    .select("id")
    .eq("franchise_id", ME_ID);

  if (finalEntriesError || !finalEntries) {
    throw new Error(`Failed to count Middle-earth entries: ${finalEntriesError?.message ?? "unknown error"}`);
  }

  const { error: totalError } = await supabase
    .from("franchise_collections")
    .update({ total_entries: finalEntries.length })
    .eq("id", ME_ID);

  if (totalError) {
    throw new Error(`Failed to update Middle-earth total_entries: ${totalError.message}`);
  }

  console.log("Middle-Earth fix complete!");
}

main().catch(console.error);
