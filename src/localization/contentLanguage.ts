import i18n from "./i18n";
import { normalizeAppLanguage, type AppLanguage } from "./types";

/**
 * The language every CONTENT request and cache key is keyed by.
 *
 * i18next's `changeLanguage` is asynchronous. The app settings store is not:
 * picking a language re-renders every screen with the new `language` value
 * immediately, while `i18n.resolvedLanguage` keeps reporting the OLD one until
 * the change resolves a tick or two later. Anything that read the language from
 * i18next inside that window — the TMDB `language` request param, the poster
 * hydration cache key — acted on the language the user had just left.
 *
 * Two visible bugs came out of that gap:
 *
 *  - Switching Turkish → English refetched and cached posters/titles under the
 *    `tr` key, so the profile shelves showed Turkish posters under an English
 *    UI until the screen was remounted.
 *  - Screens whose effects key off the settings value fetched once with the old
 *    language and again once i18next caught up, so every language switch was
 *    followed by a stretch of duplicated, visibly slow loading.
 *
 * Setting this synchronously closes the window: the settings store writes here
 * before it re-renders, so the first render after a switch already resolves
 * content in the new language.
 */
let activeContentLanguage: AppLanguage | null = null;

export function setActiveContentLanguage(language: AppLanguage): void {
  const normalized = normalizeAppLanguage(language);
  activeContentLanguage = normalized;

  // Keep i18next in step for the UI strings. It stays async — that is fine,
  // because nothing keyed on content reads from it any more.
  if (normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language) !== normalized) {
    void i18n.changeLanguage(normalized);
  }
}

export function getActiveContentLanguage(): AppLanguage {
  return activeContentLanguage ?? normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language);
}
