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
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue" /></a>
</p>

---

## Highlights

- **Discovery** — personalised picks, trending lists, similar titles and franchise timelines.
- **Native playback** — multi-provider stream resolution into a native HLS player with quality, audio and subtitle selection.
- **Library** — watchlist, likes, watch history and viewing stats, synced across devices.
- **Watch Together** — private two-person rooms with synced playback, peer-to-peer video chat and shared polaroid memories.
- **Over-the-air updates** — JavaScript updates ship through EAS Update without a store release.
- **English and Turkish** interface.

## Tech Stack

| Layer | Choice |
| --- | --- |
| App | React Native 0.81, Expo SDK 54, TypeScript |
| UI | styled-components, Reanimated 4, React Navigation |
| Player | expo-video |
| Backend | Supabase (auth, Postgres, storage, realtime, edge functions) |
| Data | TMDB via a Cloudflare Worker proxy, OMDb ratings via a Supabase edge function |
| Calls | react-native-webrtc with Cloudflare Realtime TURN |
| Build & delivery | EAS Build, EAS Update |

## Quick Start

Requires Node.js 22 and a Supabase project plus TMDB proxy credentials. The app uses native
modules (WebRTC, camera), so run it in an EAS development build rather than Expo Go.

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
| `npm run check:hdfilm` | Check the HDFilm stream decoder against live titles |

## Project Structure

```
src/        App source: screens, components, hooks, services, localization
tests/      Unit tests (node:test)
supabase/   Database migrations, seed data and edge functions
workers/    Cloudflare Workers (TMDB proxy, provider monitor, TURN credentials)
docs/       Architecture and operations notes
scripts/    Maintenance and health-check scripts
```

See [`ENGINEERING.md`](ENGINEERING.md) for the runtime, deploy workflow and engineering guardrails.

## License

[MIT](LICENSE) © Eshgin Mammadov
