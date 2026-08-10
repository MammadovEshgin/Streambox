# Streambox — Engineering Context & Guardrails (read first)

This file is the operating manual for anyone (human or AI) making changes to this
repo. The task prompt that pointed you here assumes you have read and will obey
everything below. When in doubt, **stop and ask** rather than guess.

---

## 1. What the app is

- React Native + Expo (SDK 54) mobile streaming app. TypeScript, styled-components,
  React Navigation, Reanimated v4, react-native-svg.
- Data: TMDB (primary), OMDB + imdbapi.dev (ratings), Letterboxd (scraping).
- Streaming is resolved **natively** (no WebView/iframe player) via provider
  scraping in `src/services/WebPlayerService.ts` (HDFilm → Dizipal → Dizibal chain).
- Backend: Supabase (Postgres + RPC + Storage). User data sync lives in
  `src/services/userDataSync.ts`. SQL lives in `supabase/migrations/`.

### Key files you will likely touch
| Area | File |
|------|------|
| Provider search / stream resolution | `src/services/WebPlayerService.ts` |
| Match scoring (title + year) | `WebPlayerService.ts` → `scoreMatch`, `scoreHdFilmResult`, `scoreDizipalResult`, `probeDizipalDirectSlug` |
| Player entry point | `src/screens/PlayerScreen.tsx` (`buildWebPlayerRequest`, `resolveWebPlayerUrl`) |
| Watch-history state/hook | `src/hooks/useWatchHistory.ts` |
| Watched-episode state | `src/hooks/useWatchedEpisodes.ts` |
| Season-log confirm handler | `src/screens/SeriesDetailScreen.tsx` → `handleWatchedConfirm` |
| Season-log modal UI | `src/components/detail/SeriesWatchedModal.tsx` |
| Profile watched/watchlist/liked shelves | `src/screens/ProfileScreen.tsx` |
| Supabase sync (queue, upsert, prune) | `src/services/userDataSync.ts` |
| Media hydration cache | `src/services/mediaHydration.ts` |
| DB schema | `supabase/migrations/*.sql` |

---

## 2. OTA runtime tracks — THIS IS THE MOST IMPORTANT SECTION

There are **three live OTA runtimes** served on EAS Update channel **`preview`**. EAS
routes each update to installs by their **`runtimeVersion`** — an update published
for one runtime is invisible to the others. Native code cannot ship over OTA; only
JS/asset changes do. **OTA routing is by `runtimeVersion` + channel, never by git
branch name** — the branch names below are organizational, so publishing depends on
the `app.config.js` runtime, not the branch you happen to be on.

| Runtime | Branch | Fleet | Hard rule |
|---------|--------|-------|-----------|
| **1.2.0** | `v1.2.0` (renamed 2026-07-23 from `release/1.2.0-watch-together`; folds in `feat/azerbaijani-classics`) | Watch Together APK build | Adds native `react-native-webrtc` + `expo-camera`. **Isolated — never ported back to 1.1.0/1.0.2.** `runtimeVersion` in `app.config.js` is a fixed `"1.2.0"`, so publishing from this branch auto-isolates. See **§2A**. **Player autonomy** (auto-mark-watched, next-episode, episode picker) was folded in 2026-07-28 (JS-only, ships as a 1.2.0 OTA); see **§2B**. The abandoned 1.3.0 social platform was removed the same day (teardown migration `20260728090000`). |
| **1.1.0** | `release/1.1.0-navbar` (primary working branch) | Nav-bar APK build | Normal track. `runtimeVersion` in `app.config.js` is `1.1.0`. |
| **1.0.2** | `release/1.0.2-legacy` | Legacy fleet, **no nav-bar** | **MUST NEVER contain nav-bar code** (see below). |

### Other branches
- `main` — protected. Currently **behind** the release branches (its tip is a revert). Never merge work into it, never force-push it.
- `feature/android-tv` — **real, in-progress** Android TV work (its own commit line, not in the release branches). Do NOT treat as stale; do NOT delete.
- Ephemeral `feat/*` work branches — cut from a release branch, ship by porting into **both** release branches, then delete once `git diff <release> <branch>` is empty. Don't let them accumulate.
- `archive/navbar-apk-base` (tag) — the retired `release/navbar-apk` base of the 1.1.0 line, preserved for history; fully contained in `release/1.1.0-navbar`.

### Non-negotiable OTA rules
1. **1.0.2 must NEVER include `expo-navigation-bar` / `NavigationBar` / `systemNavigationBar` / `expo-navigation` code.** These crash legacy APKs. When porting a file from the 1.1.0 branch to the 1.0.2 branch, diff it and confirm **zero** nav-bar references before committing. This has bitten us before — a wholesale `git checkout release/1.1.0-navbar -- PlayerScreen.tsx` dragged nav-bar imports onto 1.0.2. Verify with:
   ```bash
   git diff HEAD -- <file> | grep -Ei "navigation-bar|NavigationBar|expo-navigation|systemNavigation"
   ```
   It must print nothing.
2. **Any change that adds or upgrades a native module cannot go OTA.** It requires a new native build **and** a `runtimeVersion` bump (e.g. `1.2.0`). Do **not** reuse `1.1.0` for a build that adds a native module — existing `1.1.0` installs would crash on the next OTA when they call the missing module. Prefer pure-JS solutions to stay OTA-deliverable (this is why the loader was rebuilt with SVG+Reanimated instead of Lottie).
3. To ship to both fleets you commit the JS change on **both** branches (port `release/1.0.2-legacy` from `release/1.1.0-navbar`, respecting rule 1) and publish an EAS update for each runtime.
4. **Fleet policy (2026-07-25, user decision):** New feature development targets ONLY the newest runtime going forward — currently **1.2.0** (branch `v1.2.0`). (A separate 1.3.0 runtime was planned for a social platform + player autonomy but was abandoned 2026-07-28; the social platform was dropped entirely and the player-autonomy features were folded into 1.2.0 as a JS-only OTA.) Older runtimes (1.0.2 / 1.1.0) receive shared OTA updates **only for streaming-provider/source fixes and critical bug fixes** — no feature back-ports.

### Current deployed state (last updated 2026-08-10, 1.2.0 search + player + daily-hero batch)

| Runtime | Branch @ commit | EAS update group |
|---------|-----------------|------------------|
| 1.2.0 | `v1.2.0` @ `3eb6b70` | `de6dcbdb-b64d-4e4b-9d06-2d7b512f6852` |
| 1.1.0 | `release/1.1.0-navbar` @ `6658bff` | `b4a79405-d989-4b16-858d-0f3bb1ebb055` |
| 1.0.2 | `release/1.0.2-legacy` @ `f9cfc56` | `0513cd3d-1105-4d9c-b954-a8cb1b54c190` |

- **2026-08-10 (1.2.0 only):** Search, player and daily-hero batch.
  (1) **Films with a non-Latin original title reported "Not Available"** —
  `generateSearchQueries` emitted the TMDB original title first and the 2-query
  empty-result cutoff counted from the top, so Harakiri (original title `切腹`)
  never got `/search/?q=Harakiri` sent at all; every Japanese/Korean/Chinese/
  Cyrillic/Arabic-titled film failed identically. Bare titles go first now and
  the cutoff is a floor raised by `bareTitleCount`. (2) **±1-year provider
  metadata accepted** — HDFilm dates *Dune: Part Two* 2023 against TMDB's 2024
  and the hard year gate threw it out; exact-year listings still win on score.
  (3) **Audio menu showed every track as "Unknown"** — expo-video's Android
  `AudioTrack.fromFormat` builds its label from `format.language` alone and drops
  `format.label`, so DUAL masters (NAME, no LANGUAGE) produced two identical
  rows; names are recovered from the media3 format id `<GROUP-ID>:<NAME>`. This
  also repaired the original-audio preference, which had nothing to match on and
  was leaving the provider's `DEFAULT=YES` Turkish dub playing. (4) **Subtitles
  default to off**, with provider `DEFAULT=YES` renditions cleared on every track
  republish. (5) **Movie/series of the day rotates daily** — the hash-modulo pick
  collided across consecutive days, the rate-limit fallback used a date-free
  index, and a hub refresh racing the liked/watched load stamped yesterday's hero
  as current (for an account with no liked/watched titles that never self-healed).
  Deploy: 1.2.0 `3eb6b70` → group `de6dcbdb-b64d-4e4b-9d06-2d7b512f6852`.
  1.1.0/1.0.2 NOT shipped. 335 tests green.

  Also recorded in `decoder-recovery.md`: `www.hdfilmcehennemi.nl` now serves a
  Cloudflare interactive challenge on `/rplayer/` embeds, `/dizi/` series pages
  and every `/ajax*` endpoint. Those titles cannot resolve natively from HDFilm
  and fall through to Dizipal/Dizibal — **not** a decoder rotation.

- **2026-08-02 (1.2.0 only):** Provider + playback batch. (1) **HDFilm decoder
  rebuilt as an interpreter** — the provider swapped its arithmetic de-scramble
  for a rolling-XOR cipher and randomizes the whole `dc_*()` scheme per request,
  so the old matcher failed on *every* HDFilm title; films silently played from
  Dizipal/Dizibal (Turkish-dub-only audio) after burning the full ~15–20s
  resolver budget. New `src/services/rapidrameScript.ts` parses and replays the
  live body. (2) **Dizipal handshake repaired** — `/ajax-token` returns JSON now,
  the token is single-use, and the config POST needs the whole cookie jar.
  (3) **Native players only** — Dizipal page/embed shells are no longer returned
  as playable results. (4) **Audio track picker**, defaulting to the original
  soundtrack instead of the provider's `DEFAULT=YES` Turkish dub, with the choice
  remembered. (5) **Subtitles auto-enable** when the audio isn't in the app's
  language. (6) **Season watch history now syncs** — season ids were being sent
  to a `uuid` column, so prod had 2327 watch-history rows and zero season rows,
  and the failing op clogged the durable queue; ticking episodes now also
  reconciles watch history, fixing "watched on SeriesDetail, missing from
  Profile". Measured after: 13/13 live titles resolve natively in 0.9–3.2s.
  Deploy: 1.2.0 `10e5a49` → group `f192271c-b031-4a42-9619-c40c871b4f6c`. 1.1.0/1.0.2 NOT shipped.

- **2026-07-23 (1.2.0 only, follow-up):** Reverted the custom YouTube expand/
  fullscreen player from earlier today — it was worse than the stock player, so
  trailers + Azerbaijani Classics return to the original portrait iframe (its own
  controls + `onFullScreenChange` landscape handling). The rest of the batch below
  is kept. Also renamed the AZ Classics play button "Play on YouTube" → "Watch
  Now" / "Şimdi İzle". Deploy: 1.2.0 `7c6e29c` → group
  `9ad008d5-55d7-496e-b6c8-7c8b03d40c4f`.
- **2026-07-23 (1.2.0 only):** UX + stability batch. (1) **Watch Together chat is
  now durably delivered** — un-acked chat lines queue in `watchRoomService` and
  flush the moment a fresh healthy channel subscribes; the partner de-dupes by
  `(from, at)`, so a line typed across a reconnect/radio blip is no longer
  silently lost (the reported "I sent it but they never got it"). Send-side only;
  old bundles interop, no wire-format change. (2) **YouTube fullscreen** — trailers
  + Azerbaijani Classics gain an app-owned expand button (rotates to landscape,
  fills the screen; the iframe's own fullscreen is disabled) with always-visible
  close/expand controls (the iframe swallows taps). (3) **"Not available" player
  screen redesigned** — themed badge, Outfit type, pill Go-Back button, fade-in.
  (4) **Movie/Series of the Day** rebalanced toward acclaimed + popular titles
  (heavier rating + popularity weights, rating floor 7.6, higher popularity floor,
  algorithm version → `quality-v3` so today's cached pick recomputes). (5) **Launch
  splash smoothness** — the heavy Navigation + Home-hub mount is deferred past the
  splash's entrance/heartbeat beats (`CONTENT_MOUNT_GATE_MS`) so hundreds of native
  views no longer contend with the Reanimated reveal on slower/fuller phones; the
  splash stays an opaque overlay so there is still no black flash. Pure JS — no
  native/dependency/SQL change. Branch `release/1.2.0-watch-together` renamed to
  `v1.2.0` and `feat/azerbaijani-classics` recorded as merged (already a strict
  superset, so `-s ours`). Deploy: 1.2.0 `b7ef808` → group
  `409f6556-fd0a-450b-a1d7-7275d4120768`.
- **2026-07-21 (1.2.0 only):** Removed 30 incorrectly-included films that are not genuine Azerbaijani classics from `azClassics` catalog. Deploy: 1.2.0 `8681531` → group `3752ea2e-18f6-4929-8714-fc3809820e26`.
- **2026-07-13 (ALL THREE fleets):** Dizibal resolver repair + anime support.
  Dizibal retired `/api/stream/m3u8` (now 404 "Video bulunamadı" for every
  code), and the old resolver required both it and `/api/stream/embed`, so
  Dizibal produced no streams while HDFilm/Dizipal still worked. Resolver now
  follows `/api/stream/embed` → the rotating Playerjs embed HTML → the deferred
  `fetch('/dl?op=get_stream&…')` (called with an `Origin` header — it 401s
  without one) → the real `master.m3u8`, played with the embed host as
  `Referer` (CDN 403s otherwise). On-device regex, no WebView — player stays
  native. Anime SERIES now resolve via the separate `/api/anime` namespace
  (`searchDizibal` returns `{hit, kind}`; tv tries `/api/series` then
  `/api/anime`; `fetchDizibalEpisodeSrc` picks the `/seasons` root); anime
  FILMS already worked through `/api/movies`. `DIRECT_FALLBACK_TIMEOUT_MS`
  8s→12s. Pure JS in `WebPlayerService.ts` + test (no native/dependency/SQL
  change) — cherry-picked identically across all three (both files were
  byte-identical pre-fix). Deploy: 1.2.0 `b54a87c` → group
  `1116b7f6-1688-44b4-bf19-728af3e73abc`; 1.1.0 `6658bff` → group
  `b4a79405-d989-4b16-858d-0f3bb1ebb055`; 1.0.2 `f9cfc56` (nav-bar guard clean)
  → group `0513cd3d-1105-4d9c-b954-a8cb1b54c190`. Expo-verified by user on
  1.2.0 (anime plays via `kind=anime`).
- **2026-07-11 latest (1.2.0 only):** Watch Together stability repair @
  `caf8c25` → group `f06bbf09-4270-4861-a871-1984d68188cb` — memory uploads
  moved off the JS thread to cancellable native binary tasks; responder upload
  deadline covers signed-URL creation + body upload; room sends are acknowledged
  and socket/liveness checked; token refresh + reconnect/disconnect lifecycle
  races are guarded; disconnected captures are blocked/aborted; reconnecting and
  partner-left states never show the join code; chat is an in-layer overlay; a
  room-scoped recovery boundary + released-player/stream guards contain future
  white-screen paths. No wire-format, native, dependency, runtime, or SQL change.
- **2026-07-11 later (1.2.0 only):** polaroid capture flow repair @ `239955e` —
  responder still shoots at q0.3 with a 12s-bounded upload (decline on timeout;
  fixes the missing partner photo + forever-stuck spinner), getUserMedia leak on
  teardown race fixed (camera no longer wedges after rapid captures), preview
  Modal → in-layer overlay (kills the Android stuck-white-window), new
  `polaroid-preview` signal (partner sees the finished card too — both devices
  must run this bundle), shared 30s capture cooldown with countdown on the rail
  button. Author wait for the partner still is now 20s.
- **2026-07-11 (all three fleets):** launch-splash black-flash fix (splash is now an
  opaque overlay fading out over pre-painted content), Profile Movies/Series
  chip-squeeze fix (`ToggleRow` dropped `flex:1`), and the **user-data sync
  data-loss hardening** (involuntary auth loss purges tokens only — local lists +
  sync queue survive; sign-out drains the queue in rounds and preserves it across
  the wipe; cross-account guard in bootstrap; enqueue falls back to the last
  bootstrapped user id; cold bootstrap flushes pending ops before the union
  merge). Port chain: `38b01de` (1.2.0) → hunk-port `f77d5ff` (1.1.0, minus
  watch-together-only bits in App.tsx/ProfileScreen/SharedSessionsSection) →
  cherry-pick `01926b3` (1.0.2, nav-bar guard clean). 1.2.0 additionally got the
  Shared Sessions polaroid rail restyle (bare polaroids, no poster containers).
- **2026-07-10 (1.2.0 only):** Watch Together audit hardening (all 34 findings —
  ICE restart/re-announce, private Realtime channels [needs migration
  `20260710190000`], memory outbox, audio ducking, capture privacy) @ `e1b8017`
  → group `98cbce14-4460-47a7-872c-8307a51af73c`.
- Older deploy history: memory file `release-tracks.md` (agent memory) and the
  EAS dashboard. `docs/release-tracks.md` predates the 1.2.0 track and the
  branch renames — treat this section and §2 as the source of truth.

---

## 2A. Watch Together / Shared Sessions — runtime 1.2.0 (IMPORTANT, NEW)

The flagship 1.2.0 feature. A **private 2-person Watch Room**: two people join by
6-char code / deep link (`streambox://room/<code>`), watch a title in sync, see
each other's faces over the video and talk, drop text reactions, and capture
**polaroid "memories"** that land in a **Shared Sessions** section on the Profile
for **both** users. Movie-only for now (no series episode picker yet).

### Isolation (do not break this)
- 1.2.0 is a **separate native build** because it adds `react-native-webrtc@124`,
  `expo-camera@17`, `@config-plugins/react-native-webrtc@13` (v13 for SDK 54).
  These are native → **cannot** ship to 1.1.0/1.0.2 and are **never ported back**.
- Everything built this line is **additive**: new files under
  `src/components/watchTogether/`, `src/hooks/useWatchRoom*.ts`,
  `src/services/watchRoom*.ts` / `watchMemor*.ts`, new migrations, a Cloudflare
  Worker. Old runtimes are untouched.
- WebRTC is loaded **optionally** via `src/services/webrtcCompat.ts` (`getWebRtc()`
  only `require()`s when `NativeModules.WebRTCModule` exists) so the JS still runs
  in Expo Go with face-cam disabled.

### Media / networking architecture
- **Media is raw WebRTC P2P** (`src/hooks/useWebRtcPeers.ts`) + **Cloudflare
  Realtime TURN** (`src/services/turnCredentials.ts`, creds minted by
  `workers/turn-credentials/`). **Video/audio NEVER traverse Supabase** — Supabase
  Realtime only carries tiny signaling/sync/chat messages, so the free tier is fine.
- Sync is by **content timecode** (host-authoritative clock), not a shared file —
  each phone resolves its own stream via `WebPlayerService` (`useWatchRoomSession.ts`).
- **WebRTC readiness handshake**: a `webrtc-ready` signal (see `utils/watchRoom.ts`
  `WatchRoomSignal` + `negotiationActionOnPeerReady`) gates the offer so the host's
  offer can't race ahead of the guest's `RTCPeerConnection` and get dropped. The
  original "host offers immediately" flow silently never connected on real 2-device
  use (untestable with the one-phone `scripts/watchPartnerBot.ts` bot).

### Photo capture (non-obvious)
- **Do NOT view-shot the `RTCView`** — react-native-webrtc renders to an Android
  SurfaceView that screenshot APIs capture **black**. The self-still is taken with
  **`expo-camera`** by briefly handing the camera off from WebRTC
  (`setCamerasOn(false)` → snap via hidden `CameraView` in `PhotoCaptureHost` →
  `setCamerasOn(true)`; the readiness handshake reconnects). Brief live-video pause
  during the shot is the tradeoff.
- The polaroid (`PolaroidCard.tsx`) is fully code/SVG, captured at full-HD
  `captureRef(..., { width: 1080, height: 1451 })`. Backdrop uses TMDB `original`
  (only `w185/w300/w342/w500/w780/original` are valid sizes).

### Memory persistence (Shared Sessions) — know the flow
- **Local-first + cloud, reconciled in background.** On capture, `WatchRoomLayer`
  `buildPolaroid`: (1) writes the cached PNG + an AsyncStorage index entry
  **immediately** (`services/watchMemoryLocalStore.ts`, key
  `streambox/watch-memories-local`) so it shows instantly and survives leaving; then
  (2) uploads + inserts the cloud row **detached in the background**
  (`services/watchMemories.ts` → Supabase Storage `watch-memories` bucket +
  `saveWatchMemory` returns the row id) and reconciles the `cloudId`.
- `SharedSessionsSection.tsx` (Profile, below Liked) merges local store +
  `listWatchMemories` (dedup by cloudId). Share uses the **local** file (remote-URL
  share is unreliable on Android).
- **Delete is per-user**: `deleteWatchMemory` → RPC `remove_watch_memory` removes
  the caller from `participant_user_ids`; the row + Storage object are purged only
  when nobody is left.

### Migrations that MUST be applied manually (never `db push`)
`20260708120000` (platform), `20260708150000` (imdb/year/original_title cols + 3
create-room params — Create room fails without it), `20260709120000` (memories
shelf + participant-based Storage read policy), `20260709160000` (resilient
delete — wraps the Storage delete in an exception block so it can't roll back the
whole delete), **`20260710190000`** (hardening — private Realtime channels RLS,
storage UPDATE policy for outbox retries, join throttle, expired-room cleanup.
**MUST be applied BEFORE testing any build from 2026-07-10 on**: the client now
joins the room channel with `private: true`, which Realtime rejects until the
realtime.messages policies exist). Apply with `npx supabase db push` **by the
user**, not the agent.

### Deploy specifics for 1.2.0
- The CLI binary lives in package **`eas-cli`**, not `eas`: use
  `npx eas-cli@latest update --branch preview --platform android --message "…"
  --non-interactive`. Plain `npx eas …` errors ("could not determine executable").
- **Verify the output says `Runtime version 1.2.0`** — that is proof the update is
  isolated to the 1.2.0 fleet. Record the update group ID in the final report.
- This branch is standalone: **no porting to the other two release branches.**

### Hardening round (2026-07-10) — know these when debugging
Implemented from the technical audit (`outputs/shared-sessions-tech-review-2026-07-10.md`):
- **Reconnects**: offers always use `iceRestart`; `webrtc-ready` re-announces
  every 2s until SDP lands; failed / stuck-disconnected connections auto-rebuild
  (max 3 attempts, then a "Tap to retry" chip on the partner tile). Channel
  flaps rebuild + re-track presence; `connect()` resolves only on SUBSCRIBED.
- **Sync**: guest measures the host clock offset via `sync-ping/pong` (median of
  5), hard-seeks have a 5s cooldown and skip while buffering; host broadcasts
  immediately on seek jumps (owns `timeUpdateEventInterval` in rooms).
- **Audio**: mic constraints (EC/NS/AGC) explicit; 640×480@24 + 400kbps cap on
  the face-cam; **audio ducking** (`useAudioDucking` + pure
  `utils/audioDucking.ts`) drops movie volume while someone talks.
- **Memories**: OUTBOX — client-generated UUID is the memory id from birth;
  `pending` payload on the local entry; `watchMemorySync.syncPendingMemories()`
  retries upload+insert idempotently (deterministic Storage path, 23505 =
  success). Participants come from `watch_room_members`, never presence.
  Shelf loads local + cloud independently (offline shows local).
- **Privacy/security**: room channel is `private: true` (needs migration
  20260710190000 — see above); a capture request is DECLINED when the partner's
  face-cam is off (`capture-unavailable`); playback signals apply only from the
  host; TURN worker optionally requires a Supabase JWT
  (`wrangler secret put SUPABASE_JWT_SECRET`, enforced only when set).
- **Gotcha**: `scripts/watchPartnerBot.ts` (anon-key one-phone test bot) cannot
  join private channels anymore — real 2-device testing only.

### Stability repair (2026-07-11) — current behavior

- **Capture uploads**: `watchMemories.ts` obtains a Storage signed upload URL,
  then streams the JPEG/PNG through Expo FileSystem's native binary upload task.
  The responder's 12s deadline is end-to-end and cancels the native task
  best-effort; no whole-file base64 decode runs on the JS thread.
- **Realtime health**: broadcasts use server acknowledgements; normal sends and
  the 20s liveness probe first require an open Realtime socket, so REST fallback
  cannot hide a dead receive path. Failed sends coalesce into the bounded manual
  reconnect. Lifecycle generations prevent stale auth/join/remove work from
  resurrecting a room after exit, and failed initial joins invalidate their exact
  channel so late callbacks cannot create a ghost connection.
- **Auth**: the room refreshes at the 60s boundary, awaits `setAuth`, retries a
  failed/null refresh after 10s, and reconnects if the token is no longer usable.
- **Session UX**: only the never-connected lobby shows the code. A local channel
  failure shows “Reconnecting…”; an actual departure shows partner-left copy.
  Capture requires a connected channel + present partner, and a mid-capture
  disconnect aborts instead of saving a misleading one-person card.
- **White-screen containment**: chat and polaroid preview are both in-player
  overlays (no competing Watch Together native Modals). Stream/player teardown
  reads are guarded, and `WatchRoomBoundary` can retry or exit only the room layer.
- **Compatibility**: no `WatchRoomSignal` format changed. The `liveness` event is
  service-only and is not dispatched as a signal. Both devices should still run
  the current bundle so acknowledgements, capture gating, and recovery UI are
  symmetric.

---

## 2B. Player autonomy — part of runtime 1.2.0

**Player autonomy** — auto-mark-watched, the next-episode pill / auto-advance,
and the in-player episode picker — ships on the **1.2.0** runtime (branch
`v1.2.0`). It is JS-only (no native modules beyond the 1.2.0 stack), so it goes
out as a normal 1.2.0 OTA. It was built on the short-lived `v1.3.0` branch
(2026-07-25 → 2026-07-28) and folded into `v1.2.0` when the separate 1.3.0
runtime was abandoned; `v1.3.0` was then deleted.

> **Social platform removed (2026-07-28).** An earlier iteration of 1.3.0 also
> carried a Letterboxd-style social layer (usernames, a follow graph, an activity
> feed, in-app notifications, mutual-follow Watch Together invites, Android push).
> It was dropped in full at the user's request — every screen/service/hook/util,
> the `social.*` i18n, the `expo-notifications` / `expo-device` deps + plugin, and
> all of the DB objects are gone, without touching any other feature. The DB
> teardown is `supabase/migrations/20260728090000_drop_social_platform.sql` (drops
> `user_follows` / `user_activity` / `user_notifications` / `watch_invites` /
> `user_push_tokens`, every follow/activity/notify/invite/search/username RPC, the
> activity triggers on the core tables, the `profile_assets_peer_read` storage
> policy, and the `user_profiles.username` columns; restores the pre-social signup
> trigger). Apply it with `npx supabase db push` (it is idempotent / `IF EXISTS`).
> **Watch Together CORE** (join-by-code + synced playback + memories) was left
> intact — only the follow-gated invite bridge went with the social layer.

### Player autonomy
- `src/utils/playerProgress.ts` (+ `tests/playerProgress.test.ts`):
  `shouldAutoMarkWatched` (>=95% AND >=60s **real engaged** time — seeks don't
  count), `shouldShowNextEpisode` (<=45s left OR >=97%), `nextEpisodeCountdownReducer`.
- `src/hooks/useAutoMarkWatched.ts` — shares the native player's 1s ticks, fires
  once/session, reuses the manual mark-watched builders.
- `src/hooks/useNextEpisode.ts` + `src/components/player/NextEpisodePill.tsx` —
  manual "Up next" + auto-advance countdown with a persisted
  `@streambox/auto-play-next` toggle.
- `src/components/player/EpisodePickerSheet.tsx` — right-side in-layer episode
  drawer; switching an episode does a full `navigation.replace("Player", …)` so the
  resolver remounts cleanly (no stale "not available"). Native series path only;
  excluded in watch rooms.

All wired into `PlayerScreen`; typecheck + eslint clean.

---

## 3. Deploy workflow (only when the user explicitly approves)

- **Do NOT deploy OTA until the user has tested in Expo and said go.** Build/commit
  is fine to prepare; publishing is gated on the user.
- Typical sequence once approved:
  1. On `release/1.1.0-navbar`: typecheck + `npm test`, commit, push, `eas update` (runtime 1.1.0, channel `preview`).
  2. Switch to `release/1.0.2-legacy`, confirm `runtimeVersion` is `1.0.2`, port the changed files, **run the nav-bar grep guard**, typecheck + test, commit, push, `eas update` (runtime 1.0.2).
  3. Return to `release/1.1.0-navbar` and restore any stashed untracked dirs.
- Record both EAS update group IDs in your final report.

---

## 4. Hard guardrails (do NOT violate)

- **Never merge `release/1.1.0-navbar` (or any work branch) into `main`.** Keep work on branches.
- **Never force-push to `main`.**
- **Never run `supabase db push`** (or any command that mutates the production DB). Write SQL as a new timestamped migration file in `supabase/migrations/` and hand it to the user to apply. You may read/inspect, but never push schema.
- **Never echo, log, or commit secrets/credentials** (Supabase keys, tokens, `.env`). Do not print `process.env` secrets.
- **Temporary/one-off scripts live in `scripts/`** and should be deleted when done. Never leave probe scripts at repo root.
- Keep player architecture **native**: `PlayerScreen.tsx` must not contain `webview`/`iframe` player code and must keep `useNativeControls={false}`. (There is an existing HDFilm WebView *fallback* — do not extend it into the primary player.)
- Match the surrounding code style (naming, comment density, styled-components idiom). Don't reformat unrelated code.

---

## 5. Environment notes (Windows / PowerShell)

- Primary shell is PowerShell 5.1; a Git Bash tool is also available. Use the right
  syntax per shell — no `&&`/`||` chaining in PowerShell 5.1.
- Multi-line git commit messages: write the message to a temp file and use
  `git commit -F <file>` (embedded quotes in inline `-m` here-strings have mangled
  commits before). Delete the temp file after.
- Commit message trailer (adjust the model name to whoever is committing):
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## 6. Verification checklist before you call anything "done"

- [ ] `npx tsc --noEmit` (or the project's typecheck script) is clean.
- [ ] `npm test` passes (there is a `tests/webPlayerService.test.ts` suite — extend it, don't break it).
- [ ] Any new behavior has a test or a clear manual repro the user can run in Expo.
- [ ] If you touched anything that ships to 1.0.2, the nav-bar grep guard is clean.
- [ ] No secrets, no `supabase db push`, no merge to main, temp scripts removed.
- [ ] Final report lists: files changed, why, test results, and (if deploying) both EAS update group IDs.
