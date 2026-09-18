# Streambox — Engineering Context & Guardrails (read first)

This file is the operating manual for anyone (human or AI) changing this repo. The task
prompt that pointed you here assumes you have read and will obey everything below. When in
doubt, **stop and ask** rather than guess.

---

## 1. What the app is

- React Native 0.81 + Expo SDK 54 Android app (iOS config exists but is not shipped).
  TypeScript strict, styled-components, React Navigation v6, Reanimated 4,
  react-native-svg, expo-video.
- Data: TMDB (through a Cloudflare Worker proxy), OMDb ratings (through a Supabase Edge
  Function), imdbapi.dev, Letterboxd import.
- Playback: streams are resolved **on device** by scraping providers in
  `src/services/WebPlayerService.ts` (HDFilm → Dizipal → Dizibal) and played in the native
  expo-video player. An HDFilm WebView exists only as a last-resort fallback.
- Backend: Supabase (Auth, Postgres + RLS, RPCs, Storage, Realtime, Edge Functions) and
  three Cloudflare Workers.
- Watch Together: private two-person rooms with synced playback, WebRTC face-cam/voice and
  polaroid "memories" (§5).

### Key files
| Area | File |
|------|------|
| Provider search / stream resolution | `src/services/WebPlayerService.ts` (`scoreMatch`, `scoreHdFilmResult`, `scoreDizipalResult`, `probeDizipalDirectSlug`, `pickDizibalHit`) |
| HDFilm decoder interpreter | `src/services/rapidrameScript.ts` (runbook: `decoder-recovery.md`) |
| Provider base URLs (Supabase + shipped floor) | `src/services/providerConfigService.ts` |
| Player | `src/screens/PlayerScreen.tsx`; WebView policy `src/screens/player/playerWebViewPolicy.ts` |
| TMDB client + Bakcell host failover | `src/api/tmdb.ts` |
| Ratings client | `src/api/ratingsProxy.ts` |
| Watch history / episodes | `src/hooks/useWatchHistory.ts`, `src/hooks/useWatchedEpisodes.ts` |
| Supabase sync queue | `src/services/userDataSync.ts`, pure helpers `src/utils/syncQueue.ts` |
| Watch Together | `src/services/watchRoomService.ts`, `src/hooks/useWatchRoom*.ts`, `src/hooks/useWebRtcPeers.ts`, `src/components/watchTogether/` |
| OTA delivery on device | `src/services/appUpdateService.ts`, `src/components/common/LiveOpsHost.tsx` |
| DB schema | `supabase/migrations/` (see `docs/DATABASE.md`) |
| Edge Functions | `supabase/functions/` |
| Workers | `workers/tmdb-proxy`, `workers/provider-monitor`, `workers/turn-credentials` |

---

## 2. Runtime, branches and OTA

There is **one live runtime: `1.2.0`**, served on EAS Update channel/branch **`preview`**.
`runtimeVersion` in `app.config.js` is a fixed `"1.2.0"`; EAS routes an update only to
installs with the same runtime. The older 1.0.2 and 1.1.0 runtimes are retired and receive
nothing (their code survives only as the git tags `archive/release-1.0.2-legacy`,
`archive/release-1.1.0-navbar` and `archive/navbar-apk-base` — history, not work targets).

### Branches
- `v1.2.0` — the working branch. All work lands here.
- `main` — default branch, kept identical to `v1.2.0` by fast-forward only.
- Short-lived `feat/*` branches may be cut from `v1.2.0`; delete them once merged.
- Abandoned, do not resurrect: the 1.3.0 runtime / social platform (removed 2026-07-28)
  and Android TV (dropped 2026-09-17).

### OTA rules
1. **Native changes cannot go OTA.** Adding or upgrading a native module needs a new EAS
   build **and** a `runtimeVersion` bump. Prefer pure-JS solutions so a change stays
   OTA-deliverable (why the loader is SVG + Reanimated instead of Lottie).
2. Never change `runtimeVersion` to "reach more users".
3. On device, `appUpdateService` polls every 5 minutes and `LiveOpsHost` reloads silently on
   the next background → foreground transition, suppressed during playback
   (`isPlayerActive()`). There is intentionally no "Restart now" modal.

---

## 3. Deploy

Deploys happen **only when the owner approves them**. Typical sequence:

1. On `v1.2.0`: `npm run typecheck`, `npm test`, `npm run lint` (0 errors).
2. Commit, push `v1.2.0`, fast-forward `main` and push it.
3. Publish:
   ```
   npx eas-cli@latest update --branch preview --platform android --message "…" --non-interactive
   ```
   The package is `eas-cli`; plain `npx eas …` fails. **Confirm the output says
   `Runtime version 1.2.0`** and record the update group ID below.
4. Backend, when touched:
   - Workers: `cd workers/<name> && npx wrangler deploy`. Nothing auto-deploys on push.
   - Edge Functions: `npx supabase functions deploy <slug> --project-ref zbeexmqmcwtlsbbuuqor --use-api`.
     Slugs match the directory names under `supabase/functions/`.
   - Database: `npx supabase db push` after `--dry-run` (see `docs/DATABASE.md`).

### Current deployed state (2026-09-17)

| Piece | Version |
|-------|---------|
| App OTA (runtime 1.2.0, `preview`) | `v1.2.0` @ `c6357aa` → group `136302d1-fa59-4fc9-820c-5dcb3c9e13b8` |
| `streambox-tmdb-proxy` | `56f844af` (also on `tmdb.streamboxapp.stream`) |
| `streambox-provider-monitor` | `e2b74bee` |
| `streambox-turn-credentials` | `dcfe4675` |
| Latest migration | `20260916211341_restore_watch_room_realtime_policies` |
| Edge Functions | `external-ratings` v1, `user-feedback` v5, `provider-configs` v4, `refresh-hot-ratings` v3 |

### OTA history (runtime 1.2.0)
Full release notes are in `CHANGELOG.md`; commit IDs are post-rewrite (see §7).

| Date | Commit | Update group | Summary |
|------|--------|--------------|---------|
| 2026-09-17 | `c6357aa` | `136302d1-fa59-4fc9-820c-5dcb3c9e13b8` | Sync queue surfaces rejected writes with backoff/dead-letter; WebView trust anchored to hostnames |
| 2026-09-15 | `fdcdb56` | `413b4741-25b4-413f-8ca1-8015e36830e3` | Dizibal wrong-film guard, Stats cast backfill, language/poster cache, playback buffer, Bakcell host failover, launch splash |
| 2026-09-14 | `6845830` | `377d7005-7033-4da1-851a-f90370ac2fe8` | Dizipal 2130 → 2131 floor |
| 2026-09-11 | `5987121` | `4b9f5051-51cd-42d6-b34b-c476dc8a941c` | Full-title search, apostrophe queries, watched leaves watchlist, actor stats depth, nav back stack, language switch |
| 2026-09-02 | `faf0e43` | `4fc77eff-1b8f-43ff-a389-14cc79675de5` | Dizipal `data-cfg` playback, stale-base floor, HDFilm first-request challenge retry |
| 2026-08-10 | `7d08cc1` | `de6dcbdb-b64d-4e4b-9d06-2d7b512f6852` | Non-Latin titles, ±1 year, audio track names, subtitles off by default, daily hero rotation |
| 2026-08-02 | `effb1d8` | `f192271c-b031-4a42-9619-c40c871b4f6c` | HDFilm decoder interpreter, Dizipal handshake, audio picker, season history sync |
| 2026-07-23 | `70ea35c` | `9ad008d5-55d7-496e-b6c8-7c8b03d40c4f` | YouTube player revert, chat delivery, launch smoothness |

---

## 4. Operational knowledge (hard-won — read before touching providers)

### Providers
- **HDFilm (tier 1)** WAF-blocks every datacenter IP, so neither the Worker monitor nor CI can
  see it. Health comes from `npm run check:hdfilm` on a residential connection and from the
  app's `player_resolve` telemetry. Its obfuscation rotates; `rapidrameScript.ts` interprets
  the live decoder body. Follow `decoder-recovery.md`.
- HDFilm `/dizi/` pages challenge the **first** request on a fresh connection and pass after;
  `hdFilmGet()` retries past it. `/rplayer/` embeds remain unreachable.
- HDFilm does not tokenize apostrophes: search `Rosemarys Baby`, not `Rosemary's Baby`.
- **Dizipal** rotates its numbered domain (`dizipalN.com` → `N+1`, currently 2133). Hops are
  not one per rotation; a stale base costs seconds and past ~21 hops breaks axios.
  `normaliseDizipalBaseUrl` treats the shipped base as a **floor** — bump it when Dizipal
  rotates, and update the Supabase row with the Telegram bot (`/set_dizipal <url>`).
- `/set_dizipal` saves a failing candidate when the configured URL 301s to it — a brand-new
  Dizipal host can 403 the Worker for its first minutes (2026-09-18: the bot rejected the very
  command its own rotation alert suggested). Failure reasons carry the page title; the Worker
  logs only 10% of invocations, so the Telegram reply and KV state are the record.
- Dizipal's player config comes from the page's base64 `data-cfg` attribute; the network
  endpoint was renamed once already. Dizipal lists films under **Turkish** titles.
- Dizipal and HDFilm serve intermittent Cloudflare challenges; both go through `providerGet`
  / `hdFilmGet` retries.
- **Dizibal**: resolver follows `/api/stream/embed` → Playerjs embed → `/dl?op=get_stream`
  (needs an `Origin` header) → `master.m3u8` played with the embed host as `Referer`. Anime
  series live under `/api/anime`. A Dizibal hit whose own TMDB/IMDb id contradicts the request
  is never title-scored.
- **A provider alert that names a symptom the site does not have is a monitor bug until
  proven otherwise.** Re-probe from Worker egress (`npx wrangler dev --remote`) first.
- **A scoring heuristic must never outrank the literal thing the user typed** unless it has
  independent evidence (search person-index noise, rating floors on cross-language matches).

### Infrastructure
- **Bakcell** mobile data cannot reach `*.workers.dev`. `tmdb.ts` fails over to
  `tmdb.streamboxapp.stream` (same Worker). Keep both hostnames attached.
- The Supabase project signs user JWTs with **ES256**. The TURN Worker verifies them against
  the project JWKS; it only mints for `role: authenticated` tokens with a `sub`.
- Worker secrets are required; each Worker fails closed (401/503) without them. CORS allows
  no browser origins unless `ALLOWED_ORIGINS` is set.
- Logs: Cloudflare dashboard → Workers & Pages → worker → Observability, or
  `npx wrangler tail <worker>`. `streambox-turn-credentials` logs 100% of requests (events
  `issued`, `unauthorized`, `misconfigured`); the other Workers sample 10%.
- Cron `external-ratings-hot-refresh` was recreated on 2026-09-17 with the real anon key via
  `ensure_external_ratings_jobs(...)`; it is not in the baseline and must be recreated on any
  rebuilt project.
- Sync queue (`userDataSync.ts`): rejected writes back off (5s → 5min) and are dropped with
  `sync_operation_dead_lettered` telemetry after 8 server rejections; connectivity and
  expired-session failures back off but never count.

---

## 5. Watch Together

A private **2-person room**: join by 6-character code or deep link
`streambox://room/<code>`, watch a movie in sync, face-cam + voice, text reactions/chat, and
polaroid memories saved to a **Shared Sessions** shelf on both profiles. Entry point is the
movie detail screen (movies only; the episode picker is excluded in rooms). Architecture and
wire protocol: `docs/watch-together.md`.

- **The host does not need to wait for a guest.** Playback is never blocked; the "Waiting for
  your partner" card is non-interactive. When the guest joins, they sync to the host's
  position. Capturing a polaroid requires both people present.
- Native stack (why this is its own runtime): `react-native-webrtc@124`, `expo-camera@17`,
  `@config-plugins/react-native-webrtc@13`. WebRTC is loaded optionally via
  `src/services/webrtcCompat.ts`, so JS still runs where the native module is missing.
- **Media never traverses Supabase.** WebRTC is peer-to-peer with Cloudflare Realtime TURN as
  relay (credentials from `workers/turn-credentials`); Supabase Realtime carries only
  signalling, sync heartbeats, chat and presence.
- The room channel is `private: true` and authorized by two `realtime.messages` RLS policies
  (migration `20260916211341`). Without them joins are rejected.
- Sync is by **content timecode** with the host as clock; each phone resolves its own stream.
  The guest measures clock offset with `sync-ping/pong` (median of 5); hard seeks need >2s
  drift, have a 5s cooldown, and skip while buffering.
- A `webrtc-ready` handshake gates the offer so it cannot race the guest's peer connection.
  Offers use `iceRestart`; failed connections rebuild up to 3 times, then show "Tap to retry".

### Photo capture (non-obvious)
- **Do not view-shot the `RTCView`** — it renders to a SurfaceView that screenshots capture
  black. Stills are taken with `expo-camera` by briefly handing the camera off from WebRTC.
- `PolaroidCard.tsx` is code/SVG, captured at 1080×1451. Valid TMDB image sizes are
  `w185/w300/w342/w500/w780/original`.
- Uploads use a Storage signed upload URL and a native binary upload task (no base64 on the
  JS thread); the responder's 12s deadline is end-to-end.

### Memories
- Local-first: the PNG + an AsyncStorage entry (`streambox/watch-memories-local`) are written
  immediately, then uploaded in the background. The memory id is a client UUID from birth;
  `watchMemorySync.syncPendingMemories()` retries idempotently (23505 = success).
  Participants come from `watch_room_members`, never presence.
- Delete is per-user (`remove_watch_memory`); the row and file are purged only when no
  participant is left.

### Realtime health
- Broadcasts use server acknowledgements; sends and a 20s liveness probe require an open
  socket. Lifecycle generations stop stale work from resurrecting a room after exit.
- Auth refreshes at the 60s boundary, retries a failed refresh after 10s, and reconnects if
  the token is unusable.
- Only the never-connected lobby shows the code; a channel failure shows "Reconnecting…", a
  real departure shows partner-left copy.
- `scripts/watchPartnerBot.ts` no longer exists; private channels need real 2-device testing.

---

## 6. Player autonomy

- `src/utils/playerProgress.ts`: `shouldAutoMarkWatched` (≥95% and ≥60s of real engaged time),
  `shouldShowNextEpisode` (≤45s left or ≥97%), `nextEpisodeCountdownReducer`.
- `src/hooks/useAutoMarkWatched.ts` fires once per session using the manual mark-watched
  builders.
- `src/hooks/useNextEpisode.ts` + `NextEpisodePill.tsx`: "Up next" with an auto-advance
  countdown and a persisted `@streambox/auto-play-next` toggle.
- `EpisodePickerSheet.tsx`: switching episodes does `navigation.replace("Player", …)` so the
  resolver remounts cleanly.

---

## 7. Hard guardrails (do NOT violate)

- **Work lands on `v1.2.0`; `main` only fast-forwards to it.** Never force-push either without
  the owner's explicit approval.
- **Commits and PRs are authored by Eshgin Mammadov only.** No `Co-Authored-By:` or other AI
  attribution trailers. Git history was rewritten on 2026-09-14 to enforce this; commit IDs on
  the EAS dashboard from before that date are pre-rewrite.
- **Production-mutating commands need the owner's explicit approval in the current task**:
  `supabase db push`, `supabase functions deploy`, `wrangler deploy`, `eas update`, and any SQL
  that writes to production. Schema changes are always a new migration file first.
- **Never echo, log, or commit secrets** (Supabase keys, tokens, `.env`).
- Temporary scripts live in `scripts/` and are deleted when done.
- Keep the player **native**: no WebView/iframe player in `PlayerScreen.tsx` beyond the
  existing HDFilm fallback, and keep `useNativeControls={false}`.
- Match the surrounding code style; don't reformat unrelated code.

---

## 8. Environment notes (Windows)

- PowerShell 5.1 is the primary shell (no `&&`/`||`); Git Bash is also available.
- Multi-line commit messages: write to a temp file and `git commit -F <file>`.
- No Docker, `psql` or Deno on this machine; use `supabase db query --linked` for reads and
  `npx --yes deno@2 check` for Edge Functions.

---

## 9. Verification checklist before calling anything done

- [ ] `npm run typecheck` clean.
- [ ] `npm test` passes (extend the relevant suite; don't weaken tests).
- [ ] `npm run lint` has 0 errors.
- [ ] New behaviour has a test or a manual repro the owner can run.
- [ ] No secrets committed; no production command run without approval; temp scripts removed.
- [ ] Final report lists files changed, test results, and any update group ID / deploy version.
