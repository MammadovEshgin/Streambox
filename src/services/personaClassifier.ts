// Assigns the viewer persona from the MOST WATCHED genre across watch history.
//
// Genre names arrive localized (the app ships en + tr, and older history
// entries store whichever language was active when they were logged), so both
// TMDB language variants of every movie + TV genre are mapped. The previous
// classifier matched English names only, which silently failed for Turkish
// users and never matched TMDB's TV genre names at all.

export type ViewerPersonaId =
  | "thrillSeeker"
  | "dreamer"
  | "romantic"
  | "laughHunter"
  | "detective"
  | "cultureBuff"
  | "horrorFanatic"
  | "blockbusterFan"
  | "eclecticExplorer";

// TMDB genre name (en-US and tr-TR, movie + TV lists) -> persona.
const GENRE_PERSONA_PAIRS: [string, ViewerPersonaId][] = [
  // thrillSeeker
  ["Action", "thrillSeeker"],
  ["Aksiyon", "thrillSeeker"],
  ["Thriller", "thrillSeeker"],
  ["Gerilim", "thrillSeeker"],
  ["Western", "thrillSeeker"],
  ["Vahşi Batı", "thrillSeeker"],
  ["Action & Adventure", "thrillSeeker"],
  ["Aksiyon & Macera", "thrillSeeker"],
  // dreamer
  ["Science Fiction", "dreamer"],
  ["Bilim-Kurgu", "dreamer"],
  ["Fantasy", "dreamer"],
  ["Fantastik", "dreamer"],
  ["Animation", "dreamer"],
  ["Animasyon", "dreamer"],
  ["Sci-Fi & Fantasy", "dreamer"],
  ["Bilim Kurgu & Fantazi", "dreamer"],
  ["Kids", "dreamer"],
  ["Çocuklar", "dreamer"],
  // romantic
  ["Romance", "romantic"],
  ["Romantik", "romantic"],
  ["Drama", "romantic"],
  ["Dram", "romantic"],
  ["Soap", "romantic"],
  ["Pembe Dizi", "romantic"],
  // laughHunter
  ["Comedy", "laughHunter"],
  ["Komedi", "laughHunter"],
  ["Family", "laughHunter"],
  ["Aile", "laughHunter"],
  ["Reality", "laughHunter"],
  ["Gerçeklik", "laughHunter"],
  ["Talk", "laughHunter"],
  // detective
  ["Crime", "detective"],
  ["Suç", "detective"],
  ["Mystery", "detective"],
  ["Gizem", "detective"],
  // cultureBuff
  ["Documentary", "cultureBuff"],
  ["Belgesel", "cultureBuff"],
  ["History", "cultureBuff"],
  ["Tarih", "cultureBuff"],
  ["War", "cultureBuff"],
  ["Savaş", "cultureBuff"],
  ["War & Politics", "cultureBuff"],
  ["Savaş & Politik", "cultureBuff"],
  ["News", "cultureBuff"],
  ["Haber", "cultureBuff"],
  ["Music", "cultureBuff"],
  ["Müzik", "cultureBuff"],
  // horrorFanatic
  ["Horror", "horrorFanatic"],
  ["Korku", "horrorFanatic"],
  // blockbusterFan
  ["Adventure", "blockbusterFan"],
  ["Macera", "blockbusterFan"],
  ["TV Movie", "blockbusterFan"],
  ["TV film", "blockbusterFan"],
];

const GENRE_TO_PERSONA = new Map<string, ViewerPersonaId>(
  GENRE_PERSONA_PAIRS.map(([name, personaId]) => [name.toLowerCase(), personaId])
);

/**
 * Tallies genres exactly like the GenreBreakdown chart (one count per tag per
 * entry), then walks the ranked genres and returns the persona of the highest
 * counted genre that has a mapping. The persona card therefore always mirrors
 * the top of the visible genre chart, in any app language.
 */
export function classifyViewerPersona(entries: { genres: string[] }[]): ViewerPersonaId {
  const genreCounts = new Map<string, number>();

  for (const entry of entries) {
    for (const genre of entry.genres) {
      const key = genre.trim().toLowerCase();
      if (key.length === 0) {
        continue;
      }
      genreCounts.set(key, (genreCounts.get(key) ?? 0) + 1);
    }
  }

  if (genreCounts.size === 0) {
    return "eclecticExplorer";
  }

  const ranked = [...genreCounts.entries()].sort((left, right) => right[1] - left[1]);
  for (const [genre] of ranked) {
    const personaId = GENRE_TO_PERSONA.get(genre);
    if (personaId) {
      return personaId;
    }
  }

  return "eclecticExplorer";
}
