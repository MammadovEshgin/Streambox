# Changelog

All notable changes to StreamBox are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Runtime version (EAS Updates compatibility): **1.0.2**

## [Unreleased]

### Added

- ESLint 9 (flat config, built on `eslint-config-expo`) + Prettier with `npm run lint` / `npm run format` scripts.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) — runs `typecheck` + `lint` + `test` on every push and PR to `main`.
- `SECURITY.md` describing the vulnerability disclosure policy.
- `CHANGELOG.md` (this file).

### Removed

- `content-sources/az-classics/` (767 files, 56MB) — never wired into the app.
- `.agent/` — duplicate of `.agents/skills/`.
- `src/components/common/LaunchAnimationOverlay.tsx` — never imported.
- Unused assets (`announcement-logo-banner.png`, superseded `frenchise-card-bg.jpg`).
- Empty directories (`src/screens/tv/`, `scripts/lib/`).
- `hermes-parser` from direct dependencies — already pulled in transitively by Expo + RN.

## [1.0.2] — 2026-06-16

### Fixed

- **Dune (2021) opening Dune (1984)** — hard year gate in `findBestHdFilmMatch` and `searchDizipal` rejects candidates whose known year disagrees with the target.
- **HDFilm WebView shown when Dizipal had a working stream** — WebView fallbacks are now deferred until every native provider has been tried (Dizipal native/embed + Stremio direct).
- **Harry Potter / Fantastic Beasts not playing** — `getTurkishAlternativeTitle` now queries TMDB's `/translations` endpoint (canonical Turkish title) instead of the rarely-populated `/alternative_titles`. Title normalization also folds the Turkish dotless ı (U+0131) to "i" before stripping non-alphanumerics, so "Yadigârları" correctly matches the slug "yadigarlari".
- **"Cuban Fury" returned for "Fury"** — substring-only matches no longer get the wrong-year boost; the score stays below the provider cutoff so the resolver falls through.
- **HDFilm Rapidrame decoder rotation** — auto-derived `reverse → b64 → rot13` scheme added.

### Changed

- Movie / Series of the Day rolls over at local midnight (with AppState wake-up for sleeping devices).
- Daily-pick cold start always fetches fresh.
- Persisted hub caches hydrate into memory before first render (no more skeleton flash on cold start).
- `fallbackToCacheTimeout` raised to 3000ms so new APK installs jump to the latest OTA on first launch.
- Deactivated the legacy "New APK Available" Supabase announcement (was greeting fresh installs as a confusing pop-up).

### Removed

- Removed the in-app "Restart Now" modal — OTA updates apply silently on the next background→foreground transition while the player is idle.
- Removed the abandoned cloud-VM automation scripts (Oracle / GitHub Actions). Decoder rotation is now handled via the manual playbook in [`decoder-recovery.md`](decoder-recovery.md).

## [1.0.1] — Earlier

Baseline runtime. Initial multi-provider resolver, Supabase user-data platform, taste profiles, franchise timelines, native expo-video player.
