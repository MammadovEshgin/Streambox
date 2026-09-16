# StreamBox — agent instructions

Read [`ENGINEERING.md`](ENGINEERING.md) before changing anything. It is the source of truth for
the runtime, branches, deploy rules and hard guardrails; this file is only a summary.

## Stack
- React Native 0.81 + Expo SDK 54 (custom dev/preview builds — Watch Together's native
  WebRTC and camera modules do not run in Expo Go), TypeScript strict.
- UI: styled-components, Reanimated 4, react-native-svg. Navigation: React Navigation v6
  (bottom tabs plus stack screens).
- Playback: on-device provider resolution (`src/services/WebPlayerService.ts`) into native
  expo-video.
- Backend: Supabase (email/Google sign-in, Postgres + RLS, Storage, Realtime, Edge Functions)
  and Cloudflare Workers (`workers/`).

## Working rules
- Work on `v1.2.0`; `main` only fast-forwards to it.
- Commits are authored by Eshgin Mammadov only — no AI attribution trailers.
- Never commit or print secrets; never run production deploys or database pushes without the
  owner's explicit approval.
- Before calling work done: `npm run typecheck`, `npm test`, `npm run lint` (0 errors).
- Keep components small and single-purpose, reuse `src/components/common`, and match the
  surrounding code style.

## Where things are documented
| Topic | Doc |
|---|---|
| Runtime, deploys, providers, Watch Together, guardrails | `ENGINEERING.md` |
| HDFilm decoder breakage runbook | `decoder-recovery.md` |
| Database schema and migrations | `docs/DATABASE.md` |
| Watch Together architecture and wire protocol | `docs/watch-together.md` |
| OTA delivery, announcements, telemetry queries | `docs/live-ops.md` |
| Static assets vs. Supabase | `docs/backend-hybrid-architecture.md` |
| Workers | `workers/*/README.md` |
