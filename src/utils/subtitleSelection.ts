/**
 * Default subtitle selection policy.
 *
 * The player used to start every stream with subtitles OFF, leaving the viewer
 * to open the CC menu on each title. That became actively wrong once audio
 * started defaulting to the ORIGINAL soundtrack instead of the provider's
 * Turkish dub (see utils/audioTracks): a Turkish-speaking viewer would get
 * English audio and no subtitles at all.
 *
 * So: when the soundtrack we're playing is not in the viewer's app language,
 * turn on a subtitle track in their language if the stream carries one. When
 * the audio already matches, stay off — subtitles nobody asked for are noise.
 *
 * Pure, so the policy is testable without a player.
 */

export type SubtitleOptionLike = {
  /** Human label, e.g. "English", "Turkish", "Forced". */
  label: string;
  /** Language tag as published by the provider: "en", "eng", "tur", "for", … */
  lang: string;
};

/**
 * Providers mix ISO 639-1 ("en") and 639-2 ("eng"), and HDFilm emits "for" for
 * its forced track — a code that is not a language at all. Fold everything to a
 * 2-letter code so the comparison against the app language is meaningful.
 */
const THREE_LETTER_LANGUAGES: Record<string, string> = {
  eng: "en",
  tur: "tr",
  spa: "es",
  fre: "fr",
  fra: "fr",
  por: "pt",
  ger: "de",
  deu: "de",
  rus: "ru",
  ara: "ar",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  zho: "zh",
  chi: "zh",
};

const LABEL_LANGUAGES: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /t[üu]rk|turkish/i, code: "tr" },
  // "İngilizce" lowercases to i + combining dot, so plain "ing" won't match it.
  { pattern: /english|ngiliz|\beng\b/i, code: "en" },
  { pattern: /alman|german|deutsch/i, code: "de" },
  { pattern: /frans|french/i, code: "fr" },
  { pattern: /[ií]spany|spanish|espa[nñ]ol/i, code: "es" },
  { pattern: /portug/i, code: "pt" },
  { pattern: /rus/i, code: "ru" },
  { pattern: /arap|arabic/i, code: "ar" },
];

/** A "forced" track only covers signs and foreign dialogue, never full speech. */
export function isForcedSubtitle(track: SubtitleOptionLike): boolean {
  return /\bforced?\b|zorunlu/i.test(`${track.label ?? ""} ${track.lang ?? ""}`);
}

/** Best-effort 2-letter language code for a subtitle track; "" when unknown. */
export function normalizeSubtitleLanguage(track: SubtitleOptionLike): string {
  if (isForcedSubtitle(track)) return "";

  const raw = (track.lang ?? "").trim().toLowerCase();
  if (raw && raw !== "und" && raw !== "unknown") {
    if (THREE_LETTER_LANGUAGES[raw]) return THREE_LETTER_LANGUAGES[raw];
    if (/^[a-z]{2}$/.test(raw)) return raw;
    // Locale tags like "en-US" / "pt_BR".
    const prefix = raw.slice(0, 2);
    if (/^[a-z]{2}$/.test(prefix) && raw.length > 2 && /[-_]/.test(raw[2] ?? "")) return prefix;
  }

  const label = track.label ?? "";
  for (const { pattern, code } of LABEL_LANGUAGES) {
    if (pattern.test(label)) return code;
  }

  return "";
}

/**
 * Pick the subtitle to enable when playback starts.
 *
 * Returns null — meaning "leave subtitles off" — when the audio already matches
 * the viewer's language, when the audio language is unknown, or when the stream
 * has no track in their language. Forced tracks are never chosen automatically:
 * as a primary subtitle they look broken, showing a handful of cues across a
 * whole film. They stay available in the menu.
 */
export function pickDefaultSubtitle<T extends SubtitleOptionLike>(
  tracks: T[],
  options: { appLanguage: string; audioLanguage: string }
): T | null {
  if (!Array.isArray(tracks) || tracks.length === 0) return null;

  const appLanguage = (options.appLanguage ?? "").trim().toLowerCase().slice(0, 2);
  const audioLanguage = (options.audioLanguage ?? "").trim().toLowerCase().slice(0, 2);
  if (!appLanguage || !audioLanguage) return null;
  if (appLanguage === audioLanguage) return null;

  return (
    tracks.find(
      (track) => !isForcedSubtitle(track) && normalizeSubtitleLanguage(track) === appLanguage
    ) ?? null
  );
}
