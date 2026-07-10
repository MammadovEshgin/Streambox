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
| **1.2.0** | `release/1.2.0-watch-together` | Watch Together APK build | Adds native `react-native-webrtc` + `expo-camera`. **Isolated — never ported back to 1.1.0/1.0.2.** `runtimeVersion` in `app.config.js` is a fixed `"1.2.0"`, so publishing from this branch auto-isolates. See **§2A**. |
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
shelf + participant-based Storage read policy), **`20260709160000`** (resilient
delete — wraps the Storage delete in an exception block so it can't roll back the
whole delete). Apply with `npx supabase db push` **by the user**, not the agent.

### Deploy specifics for 1.2.0
- The CLI binary lives in package **`eas-cli`**, not `eas`: use
  `npx eas-cli@latest update --branch preview --platform android --message "…"
  --non-interactive`. Plain `npx eas …` errors ("could not determine executable").
- **Verify the output says `Runtime version 1.2.0`** — that is proof the update is
  isolated to the 1.2.0 fleet. Record the update group ID in the final report.
- This branch is standalone: **no porting to the other two release branches.**

### Known open technical questions (flagged for review, not yet solved)
Cross-NAT connectivity across different Wi-Fi / cellular+Wi-Fi (TURN relay
coverage), **audio ducking** (lower movie volume while a partner speaks, restore
after), and cloud-upload **retry on failure** are not yet hardened. See the
technical-review prompt handed to the reviewer.

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
