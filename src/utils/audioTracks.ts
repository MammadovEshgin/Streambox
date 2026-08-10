/**
 * Audio-track selection policy for dual-audio provider streams.
 *
 * HDFilmCehennemi serves most catalogue titles as a "DUAL" HLS master carrying
 * two audio renditions:
 *
 *   #EXT-X-MEDIA:TYPE=AUDIO,NAME="Turkish",DEFAULT=YES,URI="sublist_aud1.txt"
 *   #EXT-X-MEDIA:TYPE=AUDIO,NAME="Original Audio",DEFAULT=NO,URI="sublist_aud2.txt"
 *
 * Note what the provider marks as DEFAULT: the Turkish dub. ExoPlayer honours
 * that flag, so an untouched player plays a dubbed soundtrack for every film —
 * which is why "Pirates of the Caribbean has English audio on the site but only
 * Turkish in the app". The renditions also carry NO `LANGUAGE` attribute, so
 * `track.language` is empty/"und" and language-code matching alone can't tell
 * them apart; the human-readable NAME is the only reliable signal.
 *
 * ...and expo-video does not hand us that NAME. On Android its
 * `AudioTrack.fromFormat` builds the label purely from `format.language`:
 *
 *   val label = language?.let { Locale(it).displayLanguage } ?: "Unknown"
 *
 * `format.label` — which media3 DOES populate from the manifest's NAME — is
 * dropped. So on a provider stream with no LANGUAGE attribute every rendition
 * arrives as `{ language: null, label: "Unknown" }`: the menu showed two
 * identical "Unknown" rows, AND the preference below had nothing to match on,
 * so it left the provider's Turkish-dub DEFAULT playing.
 *
 * The NAME does survive in one place. media3's HLS parser builds the format id
 * as `GROUP-ID + ":" + NAME`, and `deriveFormat` carries it onto the runtime
 * track, so `track.id` reads "group_closedual:Original Audio". `readTrackName`
 * below recovers the name from there, which is what makes both the menu and
 * the policy work again.
 *
 * Everything here is pure so the policy can be unit-tested without a player.
 */

export type AudioTrackLike = {
  /**
   * media3 HLS format id, "<GROUP-ID>:<NAME>". Absent on iOS (AVFoundation
   * tracks carry a real displayName instead) and on non-HLS containers, where
   * it degrades to a bare track index.
   */
  id?: string;
  /** ISO-ish code from the manifest. Often "" or "und" on provider streams. */
  language: string;
  /** Human label, e.g. "Turkish", "Original Audio", "English". */
  label: string;
};

/**
 * What soundtrack the viewer wants. "original" is the default because the
 * catalogue is overwhelmingly non-Turkish content that merely happens to be
 * sourced from Turkish providers.
 */
export type AudioPreference =
  | { kind: "original" }
  | { kind: "language"; language: string };

export const DEFAULT_AUDIO_PREFERENCE: AudioPreference = { kind: "original" };

/** Label fragments providers use to mark the undubbed soundtrack. */
const ORIGINAL_LABEL = /\b(original|orijinal|orig)\b/i;

/**
 * Map a human label onto a language code. Providers write these in English or
 * Turkish, so both spellings are matched. Returns "" when the label names no
 * specific language (e.g. "Original Audio").
 */
const LABEL_LANGUAGES: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /t[üu]rk|turkish/i, code: "tr" },
  // "İngilizce" lowercases to an i + combining dot, so plain "ing" won't match
  // it — key off the distinctive "ngiliz" fragment as well.
  { pattern: /english|ngiliz|\beng\b/i, code: "en" },
  { pattern: /alman|german|deutsch/i, code: "de" },
  { pattern: /frans|french/i, code: "fr" },
  { pattern: /[ií]spany|spanish|espa[nñ]ol/i, code: "es" },
  { pattern: /rus(ian|ça|ca)?\b/i, code: "ru" },
  { pattern: /arap|arabic/i, code: "ar" },
  { pattern: /ital|italiano/i, code: "it" },
  { pattern: /japon|japanese/i, code: "ja" },
  { pattern: /kore|korean/i, code: "ko" },
];

/**
 * Labels expo-video invents when the manifest told it nothing. They must never
 * be shown, and must never be pattern-matched for a language either.
 */
const PLACEHOLDER_LABEL = /^(unknown|und|undefined|null|bilinmeyen)$/i;

function cleanLabel(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  return PLACEHOLDER_LABEL.test(trimmed) ? "" : trimmed;
}

/**
 * Recover the manifest's NAME from the media3 format id ("<GROUP-ID>:<NAME>",
 * e.g. "group_closedual:Original Audio").
 *
 * Returns "" for ids that carry no name: iOS omits the field entirely, and
 * progressive/MP4 tracks degrade to a bare index ("1", "1:0") that would
 * otherwise be shown as if it were a language.
 */
function nameFromTrackId(id: string | null | undefined): string {
  const separator = (id ?? "").indexOf(":");
  if (separator === -1) return "";

  const name = id!.slice(separator + 1).trim();
  if (!name || !/[a-z]/i.test(name)) return "";
  return PLACEHOLDER_LABEL.test(name) ? "" : name;
}

/**
 * The best human name we have for a rendition: expo-video's label when it is
 * real, else the NAME recovered from the format id. "" when neither says
 * anything — the caller decides what to fall back to.
 */
export function getAudioTrackName(track: AudioTrackLike): string {
  return cleanLabel(track.label) || nameFromTrackId(track.id);
}

/** True when this rendition is the undubbed/original soundtrack. */
export function isOriginalAudioTrack(track: AudioTrackLike): boolean {
  return ORIGINAL_LABEL.test(getAudioTrackName(track));
}

/**
 * Best-effort language code for a track: the manifest's own code when it is
 * meaningful, otherwise inferred from the name. Returns "" when unknown.
 */
export function resolveAudioTrackLanguage(track: AudioTrackLike): string {
  const declared = (track.language ?? "").trim().toLowerCase();
  if (declared && declared !== "und" && declared !== "unknown") {
    return declared.slice(0, 2);
  }

  const name = getAudioTrackName(track);
  for (const { pattern, code } of LABEL_LANGUAGES) {
    if (pattern.test(name)) return code;
  }

  return "";
}

/**
 * Choose which rendition to play.
 *
 * Returns null when there is nothing to decide — no tracks, a single track, or
 * no track that satisfies the preference. A null result means "leave the
 * player on whatever it picked", never "mute the audio".
 */
export function pickPreferredAudioTrack<T extends AudioTrackLike>(
  tracks: T[],
  preference: AudioPreference = DEFAULT_AUDIO_PREFERENCE
): T | null {
  if (!Array.isArray(tracks) || tracks.length < 2) return null;

  if (preference.kind === "language") {
    const wanted = preference.language.trim().toLowerCase().slice(0, 2);
    if (!wanted) return null;
    const match = tracks.find((track) => resolveAudioTrackLanguage(track) === wanted);
    if (match) return match;
    // The viewer asked for a language this stream doesn't carry. Fall through
    // to the original soundtrack rather than silently leaving a dub playing.
  }

  const explicitOriginal = tracks.find(isOriginalAudioTrack);
  if (explicitOriginal) return explicitOriginal;

  // No rendition says "Original", which is how Dizipal labels its dual streams
  // ("Türkçe + English", "Türkçe + Deutsch + English"). Every provider StreamBox
  // pulls from is Turkish, and on a multi-audio stream the Turkish rendition is
  // the dub they added — the catalogue itself is foreign-language. So treat the
  // first non-Turkish rendition as the original soundtrack.
  //
  // The deliberate trade-off: for genuinely Turkish-origin content with an added
  // foreign dub this picks the dub. That combination is rare here, it is
  // one tap to correct, and the correction is remembered — whereas the
  // alternative (defaulting to Turkish) is what made every English-language film
  // play dubbed.
  const nonTurkish = tracks.find((track) => {
    const language = resolveAudioTrackLanguage(track);
    return language !== "" && language !== "tr";
  });
  if (nonTurkish) return nonTurkish;

  return null;
}

/** Endonym-free display names for the codes LABEL_LANGUAGES can produce. */
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  ar: "Arabic",
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  ru: "Russian",
  tr: "Turkish",
};

/**
 * Menu label for a track: the manifest NAME when we have one, else the
 * language spelled out, else a stable ordinal.
 *
 * Never returns "Unknown" — two rows reading "Unknown" is exactly the menu
 * this replaced.
 */
export function getAudioTrackLabel(track: AudioTrackLike, index: number): string {
  const name = getAudioTrackName(track);
  if (name) return name;

  const language = resolveAudioTrackLanguage(track);
  if (language) return LANGUAGE_DISPLAY_NAMES[language] ?? language.toUpperCase();

  return `Audio ${index + 1}`;
}
