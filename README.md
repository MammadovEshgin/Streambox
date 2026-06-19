# StreamBox

A high-performance mobile streaming app for discovering, watching, and tracking movies and series. Built with React Native + Expo SDK 54, with a multi-provider stream resolver that finds playable sources across HDFilmCehennemi, Dizipal, and Stremio addons.

<p>
  <img alt="Expo SDK" src="https://img.shields.io/badge/Expo-54-000020?logo=expo" />
  <img alt="React Native" src="https://img.shields.io/badge/React%20Native-0.81-61DAFB?logo=react" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" />
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Android%20%7C%20iOS%20%7C%20Android%20TV-grey" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-91%20passing-brightgreen" />
  <img alt="License" src="https://img.shields.io/badge/license-Proprietary-red" />
</p>

---

## Highlights

- **Cinematic native UI** — glassmorphism, hero parallax, smooth Reanimated transitions, dark-mode-first.
- **Discovery that learns** — taste profiles, daily picks that roll over at local midnight, "Top New This Week", smart-similar carousels, franchise timelines.
- **Real IMDb ratings on every poster** — resolved per item via `imdbapi.dev` with OMDB + TMDB fallbacks, cached aggressively.
- **Multi-provider stream resolver** — HDFilmCehennemi native decoder, Dizipal, NuvioStreams/Stremify (Stremio addons). No WebView fallback unless every native source fails. See [Stream Resolver](#stream-resolver-architecture).
- **Native expo-video player** — landscape lock, HLS quality picker, subtitle tracks parsed from master playlists, headers (Referer) forwarded for hot-link-protected CDNs.
- **Cross-device sync** — Supabase-backed watchlist, favorites, watched-state, profile.
- **Prompted OTA updates** — EAS Update channels (`preview` / `production`) download in the background, then show an explicit restart modal while the player is idle.
- **Live ops** — Supabase-backed announcements + remote provider config (rotate `hdfilmcehennemi.nl` / `dizipal2079.com` without a release).

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React Native 0.81 + Expo SDK 54 |
| Language | TypeScript 5 |
| Navigation | React Navigation (native stack) |
| Styling | styled-components + custom theme |
| Animation | Reanimated 3 |
| Player | expo-video (native) + expo-av (fallback) |
| State | React Context API + AsyncStorage |
| Backend | Supabase (auth, storage, postgres) |
| Data | TMDB API (via Cloudflare Worker proxy) |
| Build & OTA | EAS Build + EAS Update |

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo Go (for development) **or** an EAS-built dev client
- TMDB API access (proxy URL or local API key)
- Supabase project (URL + anon key)

### Setup

```bash
git clone https://github.com/MammadovEshgin/Streambox.git
cd Streambox
npm install
cp .env.example .env       # fill in TMDB + Supabase values
npm start
```

Then press `a` (Android), `i` (iOS), or scan the QR with Expo Go.

> See [`.env.example`](.env.example) for every supported variable. The TMDB proxy variant is preferred — the direct `EXPO_PUBLIC_TMDB_API_KEY` / `_ACCESS_TOKEN` keys are local-dev fallbacks only and must not ship to production / EAS.

## Available Scripts

| Command | What it does |
|---|---|
| `npm start` | Start Expo dev server on LAN (port 8081) |
| `npm run start:localhost` | Same, but bind to localhost (USB-tethered devices) |
| `npm run android` / `npm run ios` | Launch directly on the connected device |
| `npm test` | Run the node:test suite (91 tests across 12 files) |
| `npm run typecheck` | `tsc --noEmit` — strict TypeScript pass |
| `npm run check:hdfilm` | Probe HDFilmCehennemi for decoder rotation (used by [`decoder-recovery.md`](decoder-recovery.md)) |

## Project Structure

```
src/
├── api/              TMDB client, IMDb ratings, OMDB fallback, franchise lookups
├── components/       Reusable UI (cards, carousels, modals, player overlays)
├── constants/        Static config, copy
├── context/          Auth, theme, language, watchlist providers
├── hooks/            Shared hooks (useTodayKey, useSyncedMediaIdList, …)
├── localization/     i18n strings (EN, TR)
├── navigation/       React Navigation stack + types
├── screens/          Home, Movies, Series, Detail, Player, Profile, Search, …
├── services/         Domain services (resolver, OTA, Supabase, runtimeCache, …)
├── settings/         User-tunable settings
├── theme/            Design tokens
├── types/            Shared TS types
└── utils/            Pure utilities

tests/                node:test suites (resolver, subtitles, auth, image URLs, …)
docs/                 Architecture & ops references (production-readiness, live-ops, …)
scripts/              check-hdfilm-resolver, asset optimizers, health checks
```

## Stream Resolver Architecture

The resolver lives in [`src/services/WebPlayerService.ts`](src/services/WebPlayerService.ts) and tries providers in priority order — a real native stream from any provider always wins over a WebView fallback from another. Order:

1. **HDFilmCehennemi (native)** — search → decode `Rapidrame` HLS via the auto-detecting `reverse → b64 → rot13` scheme, parse master playlist for resolutions + subtitle tracks.
2. **Dizipal (native)** — search → resolve `data-cfg` → `getVideoApi` → `.m3u8`.
3. **Dizipal embed** — when the direct stream isn't extractable but the embed URL is.
4. **Turkish-title retry** — fetch the TMDB `/translations` localized title (e.g. *Dune* → *Dune: Çöl Gezegeni*) and re-search both providers. Handles cross-language matching plus a Turkish-dotless-i fold so `Yadigârları` matches the ASCII slug `yadigarlari`.
5. **Dizibal (native)** — third-source REST scraper at `dizibal.com`: search → slug → `/api/series/{slug}/seasons/{N}` (or movies `src`) → `/api/stream/m3u8?code={src}`. Serves m3u8 over CDN77 commercial infrastructure that's not on the Azerbaijani ISP block lists that took out cloudnestra/embed.su. Telegram bot rotates the base URL via `/set_dizibal` when it moves.
6. **HDFilm WebView (last resort)** — only when *every* native source failed.

Hardening guarantees that have a dedicated regression test:

- **Year gate** — if both the target and a candidate have a known year and they disagree, the candidate is rejected outright. Prevents Dune (1984) from substituting for Dune (2021).
- **Substring/year-coincidence guard** — a substring title match (e.g. *Fury* in *Cuban Fury*) never gets the wrong-year boost; the score stays below the provider cutoff so the resolver falls through.
- **No JS-execution scrapers** — every stream URL is recovered via JSON/HTTP, not headless browsers. Stable on every Android skin (incl. HyperOS, MIUI) and zero runtime ad overlays.

See [`decoder-recovery.md`](decoder-recovery.md) for the manual rotation playbook when HDFilm changes their obfuscation scheme.

## Testing

```bash
npm test          # 91 tests, ~1.1s
npm run typecheck # strict tsc pass
```

Coverage focuses on the parts where a regression silently breaks playback:

- `webPlayerService.test.ts` — resolver scoring (Dune year gate, Fury substring guard, Turkish ı folding), Rapidrame decoder schemes, HLS playlist inspection.
- `directLinkService.test.ts` — Stremio addon JSON shape, subtitle extraction.
- `subtitles.test.ts` — VTT + SRT parsing, URL normalization.
- `playerArchitecture.test.ts` — locks the contract that `PlayerScreen` never imports `webview` and always renders native controls off.
- `tmdbAuth.test.ts` — dual-mode (api-key + bearer) auth with auto-retry.

## OTA Updates

The app ships behind two EAS Update channels:

| Channel | Used by | When it ships |
|---|---|---|
| `preview` | Internal devices / EAS Build dev | Every fix as it lands on `main` |
| `production` | Public APK on streamboxapp.stream | After preview soaks |

`LiveOpsHost` checks and downloads updates, then shows a visible **Restart now / Later** modal when no player is active. `Updates.reloadAsync()` runs only after the user chooses **Restart now**; updates are never silently applied from the JavaScript startup path.

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/production-readiness.md`](docs/production-readiness.md) | Pre-launch checklist (security, performance, observability) |
| [`docs/backend-hybrid-architecture.md`](docs/backend-hybrid-architecture.md) | TMDB proxy + Supabase split, key rotation |
| [`docs/supabase-user-data-architecture.md`](docs/supabase-user-data-architecture.md) | Auth flow, RLS policies, sync model |
| [`docs/live-ops.md`](docs/live-ops.md) | Announcements + remote provider config |
| [`decoder-recovery.md`](decoder-recovery.md) | Manual recovery playbook when HDFilm rotates its decoder |
| [`AGENTS.md`](AGENTS.md) | Project agent system (orchester / designer / backend_dev / qa_engineer) |

## License

Proprietary. © Eshgin Mammadov. All rights reserved.
