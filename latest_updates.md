# Latest Updates — Startup Crash Hardening + Build Fixes

> Context for future sessions (Codex / Gemini / other agents): this document
> captures a cohesive set of fixes shipped to address a production-preview
> crash where the StreamBox Android APK opened directly to Home on a fresh
> install, then surfaced a "StreamBox needs a quick refresh" screen
> (`StartupErrorBoundary`). Two bug classes were addressed in sequence:
>
> 1. **Stale-data crash chain** — restored AsyncStorage shapes from a prior
>    install combined with unguarded `rating.toFixed(...)` render calls.
> 2. **Latent CSS-in-JS crash** — a `border-radius: inherit;` declaration that
>    `css-to-react-native` cannot parse, throwing
>    `SyntaxError: unexpected token type: word` from inside the styled-components
>    pipeline.
>
> All changes are scoped, type-safe (`tsc --noEmit` clean), and preserve
> Franchise functionality. Azerbaijani Classics removal is preserved (those
> deletions predate this work).

---

## 1. Background — symptoms observed

On preview APK build (`channel: preview`):

- Fresh install opened **directly to the Home screen** instead of onboarding.
- After a few hundred ms the home flickered, then `StartupErrorBoundary`
  rendered the localized "needs a quick refresh" copy.
- **Retry** did nothing — same stale render → same throw.
- **Exit → onboarding → sign-in** brought the user back into the same loop.

A second build (after the first round of P0/P1 fixes below) still reproduced
the popup post sign-in. The on-screen error frames were
`Error: unexpected token type:word at _throw at expect`. That signature is the
**`css-to-react-native` parser**, not Hermes JSON nor Hermes RegExp. See §3.

---

## 2. Round 1 — stale-data crash chain (P0/P1)

### 2.1 Numeric guard for `rating.toFixed` (P0-1)

**Why:** `MediaCard`/`SpotlightCarousel`/etc. called `item.rating.toFixed(1)`
unconditionally. When a persisted cache (or, post-migration, a back-end
response) lacks a numeric `rating`, `toFixed` throws
`TypeError: Cannot read property 'toFixed' of undefined` and bubbles to
`StartupErrorBoundary`.

**Files**

- `src/api/mediaFormatting.ts` *(new)* — exports:
  - `formatRating(value: unknown, fractionDigits = 1): string` — coerces
    non-finite/non-number to `0`, then formats.
  - `isValidMediaItem(value): value is MediaItem` — type guard requiring
    `id` (number|string), `title` (string), `rating` (finite number).
  - `isValidMediaItemArray(value): value is MediaItem[]`.

- Replaced unguarded `.toFixed(1)` in 9 call sites:
  - `src/components/home/MediaCard.tsx`
  - `src/components/home/SpotlightCarousel.tsx`
  - `src/components/home/HomeHeader.tsx` (also tightened conditional to
    `typeof item.rating === "number" && item.rating > 0`)
  - `src/screens/MoviesScreen.tsx` (`movieOfDay.rating`)
  - `src/screens/SeriesScreen.tsx` (`seriesOfDay.rating`)
  - `src/screens/DiscoverGridScreen.tsx`
  - `src/screens/ProfileSeeAllScreen.tsx`
  - `src/screens/SearchResultsScreen.tsx` (also tightened conditional)
  - `src/screens/WatchedGridScreen.tsx` (`voteAverage`)

### 2.2 Persisted-cache shape validation on read (P0-2)

**Why:** `HomeScreen.tsx` and the Movies/Series hub screens read a persisted
runtime cache **without freshness or schema validation** before any network
fetch. A previous build's incompatible shape would hit the renderer.

**File:** `src/services/runtimeCache.ts`

- Added optional `validate?: (value: unknown) => value is T` parameter to
  `readPersistedRuntimeCache`. On failure: removes the in-memory entry **and**
  the AsyncStorage row, then returns `null`.

- Wired per-screen guards:
  - `HomeScreen.isValidHomeDiscoveryCache` for key `home-discovery-v1:<lang>`
  - `MoviesScreen.isValidMoviesHubCache` for `movies-hub-v1:<lang>`
  - `SeriesScreen.isValidSeriesHubCache` for `series-hub-v1:<lang>`

Each guard delegates to `isValidMediaItem(Array)` from `mediaFormatting.ts`
so the rating-shape contract is enforced at one point.

### 2.3 Storage schema migration (P0-3)

**Why:** Android Auto Backup (and ordinary AsyncStorage persistence) keeps
old shapes alive across reinstalls. We need a one-shot, surgical purge —
**not** a blanket `AsyncStorage.clear()` (would wipe Supabase tokens,
watchlists, sync queue, settings, joined-date, etc.).

**Files**

- `src/services/storageMigrations.ts` *(new)*
  - `STORAGE_SCHEMA_KEY = "@streambox/storage-schema-version"`
  - `CURRENT_STORAGE_SCHEMA_VERSION = "2"`
  - `runStorageMigrationsIfNeeded()` — if the persisted version doesn't match
    `CURRENT_STORAGE_SCHEMA_VERSION`, calls
    `clearPersistedRuntimeCaches()` (defined in `runtimeCache.ts`) and
    writes the new version. Errors are caught and logged with `console.warn`.

- `src/services/runtimeCache.ts`
  - `clearInMemoryRuntimeCache()` — empties the `Map`.
  - `clearPersistedRuntimeCaches()` — empties the in-memory map **and**
    removes every AsyncStorage key prefixed with
    `@streambox/runtime-cache-v1:` via `multiRemove`.

- `App.tsx`
  - New `migrationsReady` state. The migrations effect runs once on mount,
    awaits `runStorageMigrationsIfNeeded()`, then schedules
    `migrateLegacyContentImageCaches()` (existing) in the background.
  - The hydrate effect now gates on `authLoading || !migrationsReady` so no
    screen reads persisted cache before migrations complete.

**Future shape changes**: bump `CURRENT_STORAGE_SCHEMA_VERSION` to `"3"`,
`"4"`, etc. The purge runs once per device per bump.

### 2.4 Boundary retry actually recovers (P0-4)

**Why:** `StartupErrorBoundary.handleRetry` only bumped a nonce. The same
poisoned cache row was rendered on remount → same throw.

**File:** `App.tsx`

- New `handleStartupRetry` callback: calls
  `clearPersistedRuntimeCaches().catch(() => undefined)` then bumps
  `startupRetryNonce`.
- Wired into the boundary: `onRetry={handleStartupRetry}`.

### 2.5 Disable Android Auto Backup for new installs (P1-5)

**Why:** Auto Backup is the upstream cause of state surviving across
reinstalls. Disabling it doesn't help existing installs (P0-3 covers them on
the next update), but stops the bleeding for new installs.

**File:** `app.config.js` — added `android.allowBackup: false`. Confirmed
this is a supported top-level Expo config field; no plugin needed.

### 2.6 Internal-build error visibility in `StartupErrorBoundary` (P1-6)

**Why:** Generic copy hides the real failure. Internal QA needs the actual
error name/message + a stack snippet without rebuilding with full devtools.

**File:** `App.tsx`

- New module-level helpers:
  - `isInternalBuild()`: returns `true` when `__DEV__` is set, **or**
    `Updates.channel` is one of `preview | staging | internal`.
  - `summariseStack(stack, maxLines = 3)`: takes the first N lines.
  - `LAST_STARTUP_ERROR_KEY = "@streambox/last-startup-error-v1"`.

- `StartupErrorBoundary` now accepts:
  - `showErrorDetails: boolean` — toggles a styled details panel that
    renders `error.name: error.message` + `summariseStack(error.stack)`.
  - `onError?: (error, info) => void` — invoked from `componentDidCatch`.

- `AppShell` wires:
  - `showStartupErrorDetails = useMemo(isInternalBuild, [])`.
  - `handleStartupError(error, info)` — persists a JSON snapshot (`name`,
    `message`, `stack`, `componentStack`, `capturedAt`) to
    `LAST_STARTUP_ERROR_KEY`. Persisted **always** (production too) so it
    can be retrieved post-incident; the on-screen panel is gated on
    `showErrorDetails`.

### 2.7 Sign-out clears runtime caches (P1-7)

**Why:** The sign-out cleanup cleared franchise/userdata/image caches but
**not** `@streambox/runtime-cache-v1:*`. Sign-in afterwards reproduced the
same crash.

**File:** `src/context/AuthContext.tsx`

- Imported `clearPersistedRuntimeCaches`.
- Added the call to **both** cleanup paths:
  - The inactivity-expired branch in the init effect.
  - The manual `handleSignOut` callback's `Promise.all`.

---

## 3. Round 2 — `border-radius: inherit;` crash (post-rebuild)

### 3.1 Symptom

After the Round-1 build, the user signed in and saw the same boundary popup,
this time with on-screen text:

```
Error: unexpected token type:word
  at _throw (index.android.bundle:1:1460574)
  at expect (index.android.bundle:1:1460360)
```

### 3.2 Diagnosis

This signature **does not** come from Hermes JSON or Hermes RegExp parsers
despite the function names looking generic. It is the public-facing error
shape of the **`css-to-react-native`** parser used by `styled-components/native`
to translate CSS template literals into React Native style objects.

`css-to-react-native` tokenizes a CSS declaration into typed tokens
(`number`, `length`, `color`, `word`, ...) and a parser per CSS property
calls `expect(<token kind>)`; if it gets a `word` token where it wants a
length/number/color, it bubbles
`SyntaxError: Unexpected token type: word`. This is documented in the issue
trail of `styled-components/styled-components#559`.

The failing declaration was located in
`src/components/franchise/FranchiseCollectionArtwork.tsx:12`:

```ts
const ArtworkFrame = styled.View<{ $backgroundTint: string }>`
  flex: 1;
  border-radius: inherit;   // ← invalid for css-to-react-native
  overflow: hidden;
  ...
`;
```

`inherit` is valid web CSS but RN has no inheritance model; the parser sees
`inherit` as a `word` where it expects a length, and throws. The component
mounts as part of the franchise rows on Home, which is the first thing
rendered post sign-in — exactly matching the symptom of the homepage
flickering and immediately landing on the boundary.

### 3.3 Fix

**File:** `src/components/franchise/FranchiseCollectionArtwork.tsx`

Removed the invalid declaration. Visual output is preserved because the
parent container already supplies a `border-radius` plus `overflow: hidden`.

```diff
 const ArtworkFrame = styled.View<{ $backgroundTint: string }>`
   flex: 1;
-  border-radius: inherit;
   overflow: hidden;
   background-color: ${({ $backgroundTint }) => $backgroundTint};
   justify-content: space-between;
   padding: 14px;
 `;
```

Sanity sweep across `src/**/*.{ts,tsx}` for other CSS-wide keywords
(`inherit | initial | unset | revert`) inside template literals — no other
occurrences found.

---

## 4. Versioning and build commands

`app.config.js` uses `runtimeVersion.policy: "appVersion"`. Every time we
ship a fix that we want OTA-isolated from the previous broken APK, bump
`version`:

| Build | `version` | Notes                                                    |
|-------|-----------|----------------------------------------------------------|
| Pre-fix | `1.0.0` | Original buggy build.                                   |
| Round 1 | `1.0.1` | Stale-data + boundary + Auto Backup fixes.              |
| Round 2 | `1.0.2` | Added: `border-radius: inherit` removal in artwork.     |

### Current preview-build command

```powershell
npx --yes eas-cli build --platform android --profile preview
```

(The `EAS_SKIP_AUTO_FINGERPRINT=1` env var is no longer required — the
version bump regenerates a clean runtime fingerprint.)

---

## 5. Files added / modified summary

### Added

- `src/api/mediaFormatting.ts` — `formatRating`, `isValidMediaItem`,
  `isValidMediaItemArray`.
- `src/services/storageMigrations.ts` — schema-version-gated targeted purge.
- `latest_updates.md` — this document.

### Modified

- `App.tsx` — migrations gate, retry cache purge, internal-build error
  panel, last-error persistence, `expo-updates` import.
- `app.config.js` — `android.allowBackup: false`, `version` bump.
- `src/services/runtimeCache.ts` — validator option,
  `clearInMemoryRuntimeCache`, `clearPersistedRuntimeCaches`.
- `src/context/AuthContext.tsx` — clear runtime caches on inactivity expiry
  and manual sign-out.
- `src/components/franchise/FranchiseCollectionArtwork.tsx` — removed
  `border-radius: inherit;`.
- `src/components/home/MediaCard.tsx`,
  `src/components/home/SpotlightCarousel.tsx`,
  `src/components/home/HomeHeader.tsx` — `formatRating` adoption.
- `src/screens/HomeScreen.tsx`, `MoviesScreen.tsx`, `SeriesScreen.tsx` —
  cache validators wired into `readPersistedRuntimeCache`.
- `src/screens/DiscoverGridScreen.tsx`,
  `src/screens/ProfileSeeAllScreen.tsx`,
  `src/screens/SearchResultsScreen.tsx`,
  `src/screens/WatchedGridScreen.tsx` — `formatRating` adoption.

### Out of scope / preserved

- Franchise APIs, screens, and navigation routes — untouched.
- Azerbaijani Classics removal — preserved (deletions predate this work).
- Supabase/Cloudflare auth flow — untouched (sign-out cleanup extended only).
- TMDB API client (`src/api/tmdb.ts`) — untouched.

---

## 6. QA checklist

- [ ] Fresh install on a device that previously had the buggy build:
      onboarding shown first, sign-in completes, Home renders without the
      boundary popup, ratings render with one decimal.
- [ ] Inject a malformed `@streambox/runtime-cache-v1:home-discovery-v1:en`
      entry → relaunch → entry purged silently, Home renders fresh data.
- [ ] Bump `CURRENT_STORAGE_SCHEMA_VERSION` to `"3"` in a dev build →
      relaunch → runtime caches purged; auth tokens, watchlists, sync queue,
      and settings preserved.
- [ ] Force a render throw inside Home, tap **Retry** → recovers (cache
      cleared) and does not re-throw on remount.
- [ ] Sign-out → sign-in cycle: no crash on second sign-in.
- [ ] Internal build (preview channel): the boundary's details panel shows
      `Error name: message` + 3 stack lines. Production: panel hidden, but
      `@streambox/last-startup-error-v1` still written.
- [ ] Franchise rows still appear on Home, Movies, and Series tabs; tapping
      a franchise card opens `FranchiseCatalog` / `FranchiseTimeline`.
- [ ] Inactivity sign-out (after 30 days) still works; runtime caches
      cleared along with the existing teardown set.

---

## 7. Verification done

- `npx tsc --noEmit` clean after each round.
- `node -e "require('./app.config.js')()"` evaluates without error and
  reports `version: 1.0.2` and `android.allowBackup: false`.
- `Grep` over `src/` for `(rating|voteAverage)\.toFixed` — zero unguarded
  sites remain.
- `Grep` over `src/` for CSS-wide keywords (`inherit | initial | unset |
  revert`) inside styled-components templates — no remaining occurrences.

---

## 8. Glossary for downstream agents

- **`StartupErrorBoundary`** — class component in `App.tsx` wrapping only the
  authed app subtree (`<Navigation />` + `<LiveOpsHost />`). Catches
  render-time throws and shows the "needs a quick refresh" UI.
- **Runtime cache** — `Map`-backed in-memory cache with optional
  AsyncStorage persistence under prefix `@streambox/runtime-cache-v1:`,
  defined in `src/services/runtimeCache.ts`.
- **Storage schema migration** — one-shot purge keyed by
  `@streambox/storage-schema-version`. Today only purges runtime caches;
  extend the implementation if a future change needs to touch other
  AsyncStorage rows.
- **`isInternalBuild()`** — `__DEV__` or `Updates.channel ∈
  {preview, staging, internal}`. Add new channel names here if the team
  introduces them.
- **`MediaItem.rating`** — TMDB `vote_average` coerced via `Number.isFinite`
  in the API mappers (`src/api/tmdb.ts`); validators reject any item where
  this is not a finite number.
