# StreamBox — Senior Engineering & Design Review

**Reviewer:** Claude (acting as senior RN/Expo engineer + product design lead)
**Date:** 2026-06-14
**Scope:** Whole-app architecture, data/state layer, design system, UX. Read-only — no code was changed.
**Method:** Direct reading of `App.tsx`, theme, navigation, services, screens + targeted greps. Figures below were verified against the tree, not estimated.

---

## TL;DR

This is a **genuinely impressive solo/small-team app**. The hard parts — resilient startup, multi-source provider resolution, offline-tolerant sync, a themeable visual language, telemetry with redaction — are not just present, they're done with care. This is well above the median React Native codebase.

The weaknesses are almost all the **predictable scars of fast, feature-first growth**, not bad decisions:

1. **A few files have become god-objects** — `PlayerScreen.tsx` (4,206 lines) and `tmdb.ts` (2,865) are the two that will hurt most over time.
2. **The design system is defined but not enforced** — great tokens, ~15–20% of the UI bypasses them with hardcoded hex/spacing.
3. **Accessibility is effectively absent** — literally `0` accessibility props in `src/`. This is the single biggest gap relative to the app's polish.
4. **In-memory caches are mostly unbounded** — a real memory-growth risk on long sessions.
5. **No reusable UI primitives** — `Button`/`Text`/`Card` are re-implemented per screen (~50+ ad-hoc styled buttons).

None of these are emergencies. The app works and is stable. They're the difference between "great app one person can hold in their head" and "codebase a team can scale." This document is the map from the former to the latter.

---

## What's genuinely good (don't lose this)

These are strengths worth protecting as you refactor — it's easy to regress them.

- **Startup resilience is excellent.** `App.tsx` has a real `StartupErrorBoundary` class with retry + sign-out recovery, font-load fallback timers (`FONT_LOAD_FALLBACK_MS`), a first-launch fallback, persisted last-startup-error capture, and splash-screen coordination. Most apps this size crash to a white screen; this one degrades gracefully.
- **Provider config has a proper fallback chain** (`providerConfigService.ts`): remote → AsyncStorage cache → hardcoded, with a stale-domain remap table. This is exactly right for a domain-rotating provider world.
- **Telemetry is thoughtfully built** (`telemetryService.ts`): batched queue, debounced flush, **automatic redaction** of `token|authorization|apikey|secret|password|stream|cookie|session`, depth/array caps. The redaction in particular shows security awareness.
- **The HDFilm/Dizipal resolver is sophisticated.** Multi-scheme deobfuscation, HLS manifest inspection, disguised-`.jpg`-segment detection, native-vs-WebView handoff. It's a lot of hard-won domain knowledge encoded in code.
- **The theme system is well-designed** (`Theme.ts`): typed `AppTheme`, 4 named palettes, a clean `withAlpha()` helper, coherent spacing (powers of 2) and radius scales, and named motion durations.
- **Caching is genuinely multi-layered and mostly versioned** — `runtimeCache.ts` (TTL + schema version + debounced writes), `mediaHydration.ts` (bounded to 1000 persisted entries), and `franchisePosterCache.ts` (LRU-pruned file cache, 24MB/48-file cap, atomic temp-file moves). The *persisted* layers are well-bounded; it's the *in-memory* layer that isn't (see below).
- **Auth/session handling is mature** — 30-day inactivity guard, foreground refresh, invalid-refresh-token recovery, OAuth native→web fallback.

---

## Architecture weaknesses & fixes

### 1. God-files: the top priority for maintainability

Verified largest files:

| File | LOC | Assessment |
|---|---|---|
| `src/screens/PlayerScreen.tsx` | **4,206** | 🔴 Critical. ~2,000 lines are JS-as-string injected into a WebView. |
| `src/api/tmdb.ts` | **2,865** | 🟠 "All API logic in one file." Hard to navigate, owns caches + auth + endpoints. |
| `src/services/WebPlayerService.ts` | 1,823 | 🟠 Resolution + decoding + scoring + Dizipal + HLS all in one. |
| `src/screens/ProfileScreen.tsx` | 1,501 | 🟡 9 distinct styled buttons inside it. |
| `src/screens/SeriesDetailScreen.tsx` | 1,411 | 🟡 |
| `src/services/userDataSync.ts` | 945 | 🟡 Queue + profile + assets + history + episodes + recs. |

**Why `PlayerScreen.tsx` is the worst offender:** it mixes (a) React component logic, (b) ~2,000 lines of injected WebView automation written as template-string JavaScript with **no type checking, no linting, no tests, and `catch (e) {}` everywhere** (the 79 "empty catches" a scan flags here are almost all inside these strings — they're invisible to TypeScript). Subtitle parsing (VTT/SRT) also lives here. This is the highest-risk file in the app: it's central to the core feature, and the part most likely to silently break is the part the toolchain can't see.

**Fixes (incremental, no big-bang rewrite):**
- Extract the injected WebView scripts into dedicated files (e.g. `player/injected/adGuard.ts`, `player/injected/hdfilmDiscovery.ts`, `player/injected/dizipal.ts`) that export template strings. Even as strings, isolating them enables: a unit test that asserts the script is syntactically valid (`new Function(script)` in a test), and a single place to review the "browser-side" logic.
- Pull subtitle parsing (`parseWebVtt`, `parseSubRip`, `parseSubtitleDocument`, timestamp helpers) into `utils/subtitles.ts` — it's pure, easily unit-tested, and currently buried.
- Split `tmdb.ts` by concern: `tmdbClient.ts` (axios + interceptors + auth), `tmdbMovies.ts`, `tmdbSeries.ts`, `tmdbDiscover.ts`, `tmdbCaches.ts`. The shared client is the only true coupling.
- Split `userDataSync.ts` along its existing seams: `sync/queue.ts`, `sync/profile.ts`, `sync/library.ts`, `sync/history.ts`.

> Guidance: treat ~600 LOC as a soft ceiling for a screen/service. Past that, you're usually hiding 2–3 components/modules in a trench coat.

### 2. Unbounded in-memory caches (memory growth on long sessions)

The persisted caches are bounded; several **in-memory** `Map`s are not. Per the memory notes and confirmed in `tmdb.ts`, these grow for the life of the process with no eviction: `imdbIdCache`, `omdbRatingsCache`, `letterboxdCache`, `movieDetailsCache`, `seriesDetailsCache`, plus `franchisePosterCache.memoryCache` / `inFlightDownloads`. A user who browses thousands of titles in one session accumulates megabytes that never release.

**Fix:** Introduce one tiny `LruMap` (max-entries, delete-oldest-on-insert — the pattern already exists in `WebPlayerService.ts`'s `hdfilmNativeFallbackCache`) and back the detail/rating caches with it (cap ~500–1000). Clear `inFlightDownloads` entries in their `finally`. Optionally flush memory caches on `AppState` background.

### 3. No request-level dedup at the TMDB layer

`imdb.ts` and `ratingsProxy.ts` correctly use in-flight promise maps; `tmdb.ts` does **not**. Two concurrent `getMovieDetails(123)` calls (common when a list and a detail prefetch race) fire two network requests. The result is only cached *after* completion.

**Fix:** Wrap detail fetchers in the same in-flight-promise pattern already used in `imdb.ts`. Small change, meaningful under load.

### 4. No retry/backoff for transient failures

Auth 401 retries with the alternate mode (good), but timeouts, 429s, and 5xx fail immediately. For a TMDB-dependent app on mobile networks, this shows up as flaky empty states.

**Fix:** A small `withRetry(fn, {retries: 2, backoff: [200, 600]})` helper applied in the TMDB response path (skip 4xx except 429). ~1 hour, broadly felt.

### 5. Type-safety pockets

`36` occurrences of `any`/`as any` in `src/` — concentrated in `userDataSync.ts` (10), `tmdb.ts` (5), `PlayerScreen.tsx` (5), `module-shims.d.ts` (8, expected). Density is low (~0.3%) and mostly at API boundaries, but the sync layer is exactly where you *want* types, because that's where silent data corruption hides.

**Fix:** Define explicit row types for the Supabase tables and the sync payloads; replace `any` with `unknown` + a validating type guard at the boundary (the codebase already has `isMediaItem`-style guards to follow).

### 6. Provider-resilience nit

`scripts/check-hdfilm-resolver.ts` hardcodes the HDFilm base URL independent of the Supabase provider config. That's a deliberate, documented decoupling (so the health-check has no Supabase dependency), but it means a domain move needs *two* edits. Acceptable — just keep the comment that says so.

---

## Design & UX review

The visual foundation is strong and clearly the product of someone with taste (named palettes with real descriptions, negative letter-spacing on display type, a press-scale constant, glassmorphism tokens). The gap is **enforcement and inclusivity**, not aesthetics.

### 1. Accessibility — the standout gap 🔴

**Zero** `accessibilityLabel` / `accessibilityRole` / `accessibilityHint` / `accessible` props in all of `src/`. No `maxFontSizeMultiplier`/`allowFontScaling` guards. No `prefersReducedMotion` check despite ~12 animated components.

For an app this polished, this is the most surprising finding. Icon-only controls (close, CC, scaling, the whole player chrome) are invisible to screen readers; a user with large system fonts may see broken layouts; reduce-motion users get the full animation set.

**Fix (high ROI):**
- Add `accessibilityRole="button"` + `accessibilityLabel` to every `Pressable`/`TouchableOpacity`. A reusable `<Button>` (see #4) makes this a one-time cost.
- Add `maxFontSizeMultiplier` to a shared `<Text>` primitive so dynamic type can't shatter layouts.
- Gate non-essential animation on `AccessibilityInfo.isReduceMotionEnabled()`.
- Verify touch targets meet 44×44pt; several player buttons are 36×36.

### 2. Tokens defined but not enforced 🟠

The theme is great; the discipline around it leaks. Representative (verified) examples:
- Star color is `#FFD700` in `MediaCard.tsx` but `#FFD27A` in `SpotlightCarousel.tsx` — the *same concept*, two values. This is what untokenized color costs you.
- Hardcoded `#FFFFFF` for "text on primary" appears in many places (`App.tsx` StartupPrimaryText, FilterModal, etc.) — there's no `colors.textOnPrimary` token, so everyone invents `#FFFFFF`.
- `rgba(...)` literals are sprinkled where `withAlpha()` already exists for exactly this.
- Animation durations use literals (`duration(150)`, `duration(540)`) instead of the `theme.motion.*` tokens that were defined for this purpose.

**Fix:**
- Add the missing semantic tokens: `colors.textOnPrimary`, `colors.gold`/`colors.rating`, `colors.scrim`, and a `shadows` group (shadows are currently hand-rolled per component).
- Adopt an ESLint rule (e.g. `no-color-literals` from `eslint-plugin-react-native`, or a small custom rule) to **fail CI on raw hex in styled-components**. Enforcement is the only thing that keeps a token system honest over time.
- Replace literal animation durations with `theme.motion.*`.

### 3. No reusable UI primitives 🟠

`src/components/common/` contains feature components (loaders, image cache, live-ops host) but **no `Button`, `Text`, `Card`, or `Sheet`**. Consequence (verified): `ProfileScreen.tsx` alone defines **9** styled button variants; detail/settings/see-all screens each define 5–6. Modal backdrops and loading wrappers are re-implemented per screen.

This is why #1 (accessibility) and #2 (tokens) are expensive to fix today — there's no chokepoint to fix them *once*.

**Fix:** Build a small primitive layer: `<Button variant=... size=...>` (carrying a11y + press-scale + tokenized colors), `<AppText variant="TitleLarge">` (carrying typography + `maxFontSizeMultiplier`), `<Card>`, `<BottomSheet>`. Migrate screens opportunistically. This single move pays down accessibility, token drift, and duplication simultaneously.

### 4. Spacing consistency 🟡

The 8-point-ish scale exists but ~half of paddings/margins are bespoke (`padding: 0 18px`, `5px 11px`, `10px 14px`). Not broken, just visually "almost aligned." The primitive layer + lint will largely fix this.

### 5. Responsiveness 🟡

Portrait-first; `supportsTablet: true` is set but there are no tablet/landscape layouts, and `SafeContainer` pads top only (bottom home-indicator insets are mostly ignored). Fine for v1; worth a pass before any tablet push.

---

## Testing posture

9 test files, ~89 assertions — and notably they cover the *right* things (resolver auth, decoding, scoring, player architecture invariants, concurrency). That's a smart, risk-targeted suite for a solo project. The gaps that matter:
- The injected WebView scripts (highest-risk code) are untested — extracting them (#1) makes them testable.
- No tests around the sync/conflict-resolution logic in `userDataSync.ts`.
- No mocking layer for Supabase/AsyncStorage, so service-level tests are hard to write.

---

## Prioritized roadmap

Ordered by **(impact × likelihood of biting you) ÷ effort**.

### P0 — do soon (days)
1. **Add `LruMap` to the in-memory TMDB/IMDb caches.** Removes the one real "it gets slow/crashes after a long session" risk. (~2h)
2. **Accessibility baseline via a shared `<Button>`/`<AppText>`.** Biggest quality gap vs. the app's polish; the primitive makes it a one-time cost. (~1–2 days incl. migration of top screens)
3. **Request-level dedup + retry/backoff in `tmdb.ts`.** Directly reduces flaky empty states. (~3h)

### P1 — next (1–2 weeks)
4. **Extract injected WebView scripts out of `PlayerScreen.tsx`** into `player/injected/*` + a syntax-validity test. De-risks the core feature. (~1 day)
5. **Tokenize stray colors + add `colors.textOnPrimary`/`gold`/`scrim`/`shadows`; add a lint rule to block raw hex.** (~half day + ongoing enforcement)
6. **Split `tmdb.ts` and `userDataSync.ts`** along the seams noted above. (~1–2 days)

### P2 — when you can (backlog)
7. Replace `any` in the sync layer with `unknown` + guards.
8. Move subtitle parsing to `utils/subtitles.ts` with tests.
9. Reduce-motion + dynamic-type support.
10. Tablet/landscape layouts; bottom safe-area insets.

---

## Closing, honestly

The instinct to ask for this review is itself the strongest signal in the repo — most apps with these exact strengths never get audited because they "work." They do work. The resolver, the startup hardening, the telemetry redaction, the themeable palette: these are things many *funded* teams get wrong, and they're right here.

The work ahead isn't about fixing mistakes — it's about converting **individual craftsmanship into team-scalable systems**: enforce the design tokens you already designed, extract the primitives the screens are already implying, bound the caches you already version, and pull the two giant files apart along seams that already exist. None of it requires rethinking the product. It requires turning good *instincts* into good *guardrails*.

If you do only three things: **(1) a shared `<Button>` carrying accessibility, (2) `LruMap` on the memory caches, (3) extract the WebView scripts out of `PlayerScreen`.** Those three touch the largest risk surface for the least effort.
