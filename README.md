<p align="center">
  <img src=".github/assets/logo.png" alt="StreamBox" width="120" />
</p>

<h1 align="center">StreamBox</h1>

<p align="center">
  A mobile app for discovering, watching and tracking movies and series.
</p>

<p align="center">
  <img alt="Expo SDK" src="https://img.shields.io/badge/Expo-54-000020?logo=expo" />
  <img alt="React Native" src="https://img.shields.io/badge/React%20Native-0.81-61DAFB?logo=react" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-backend-3FCF8E?logo=supabase" />
  <img alt="License" src="https://img.shields.io/badge/license-Proprietary-red" />
</p>

---

## Highlights

- **Discovery** — personalised picks, trending lists, similar titles and franchise timelines.
- **Native playback** — multi-provider stream resolution into a native HLS player with quality, audio and subtitle selection.
- **Library** — watchlist, likes, watch history and viewing stats, synced across devices.
- **Watch Together** — private rooms with synced playback and peer-to-peer video chat.
- **Over-the-air updates** — JavaScript updates ship through EAS Update without a store release.
- **English and Turkish** interface.

## Tech Stack

| Layer | Choice |
| --- | --- |
| App | React Native 0.81, Expo SDK 54, TypeScript |
| UI | styled-components, Reanimated 4, React Navigation |
| Player | expo-video |
| Backend | Supabase (auth, Postgres, storage, realtime) |
| Data | TMDB via a Cloudflare Worker proxy |
| Build & delivery | EAS Build, EAS Update |

## Quick Start

Requires Node.js 22 and a Supabase project plus TMDB proxy credentials.

```bash
git clone https://github.com/MammadovEshgin/Streambox.git
cd Streambox
npm install
cp .env.example .env   # fill in the TMDB and Supabase values
npm start
```

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the Expo dev server |
| `npm run android` / `npm run ios` | Run on a connected device |
| `npm test` | Run the test suite |
| `npm run typecheck` | Type-check with `tsc` |
| `npm run lint` | Lint with ESLint |

## Project Structure

```
src/        App source: screens, components, hooks, services, localization
tests/      Unit tests (node:test)
supabase/   Database migrations
workers/    Cloudflare Workers (TMDB proxy, provider monitor, TURN credentials)
docs/       Architecture and operations notes
scripts/    Maintenance and health-check scripts
```

See [`ENGINEERING.md`](ENGINEERING.md) for runtime tracks and the deploy workflow.

## License

Proprietary. © Eshgin Mammadov. All rights reserved.
