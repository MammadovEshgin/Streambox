# Watch Together stability incident — findings and fix

Date: 2026-07-11

Branch: `release/1.2.0-watch-together`

Runtime: `1.2.0`
Field bundle under investigation: `239955e` (repository baseline for this work: `da7a343`)

Pre-fix references in the findings below refer to `da7a343`. Fix references point to the working tree prepared by this investigation.

## Root-cause summary

The downstream failure chain is deterministic in the baseline code, but static code cannot prove whether the first transport flap on the tested phones was triggered by upload pressure, the token-refresh boundary, or a radio/network event without device logs.

1. Every responder JPEG and full-HD polaroid PNG was read into a whole base64 string and synchronously decoded into another whole buffer (`src/services/watchMemories.ts:19-27`; decoder loop at `node_modules/base64-arraybuffer/dist/lib/index.js:27-45`). The responder's apparent 12-second timeout was only `Promise.race`, so the losing upload continued in the background (`src/components/watchTogether/WatchRoomLayer.tsx:324-332`). Repeated captures could therefore stack large JS allocations and orphaned uploads.
2. A normal realtime-js heartbeat/socket failure is not silent: the installed client closes on heartbeat timeout and triggers channel errors (`node_modules/@supabase/realtime-js/src/RealtimeClient.ts:456-485,788-817`; `RealtimeChannel.ts:300-302`). The room service did rebuild on those callbacks (`src/services/watchRoomService.ts:206-235`). L2's ordinary “no callback” theory is therefore disproven.
3. The app still had no independent liveness check, and every room broadcast used `ack:false`; `send()` discarded the returned `ok` / `error` / `timed out` result (`src/services/watchRoomService.ts:159-166,237-239`). Chat and reactions were optimistic (`src/hooks/useWatchRoom.ts:154-169`; `src/hooks/useWatchRoomSession.ts:283-287`), so both could look locally successful while nothing reached the partner.
4. Presence loss was converted into a six-second “partner left” state and then reset to the original lobby, including the join code (`src/components/watchTogether/WatchRoomLayer.tsx:190-206,566-574`). That exactly explains the nonsensical mid-session code pill.
5. Capture initiation checked only capture/cooldown state, not transport or partner presence (`src/components/watchTogether/WatchRoomLayer.tsx:446-475,617-629`). The author waited for a partner still only while `bothPresent` was true (`:348-360`). Once the guest UI was already in its self-only presence state, the guest capture skipped the wait and composed immediately with only the guest photo. Capture request/still/preview all use the same service send path (`src/hooks/useWatchRoom.ts:187-206`), so a preview arriving after recovery is not evidence of a second working transport.
6. The exact white-screen trigger is not provable without Android logcat. The prompt's “no ErrorBoundary” premise is stale: `App.tsx:188-248,575-592` already contains an app-wide render boundary. Confirmed remaining legs were the chat's native `Modal` (`WatchRoomLayer.tsx:674-718`), direct native stream `toURL()` calls during render (`FaceCamOverlay.tsx:58-59,92-93`), unguarded released-player timer callbacks (`useWatchRoomSession.ts:68-90,195-217`), and uncaught async media/capture work. React boundaries do not catch timer, promise, handler, or native-window failures.

## Lead-by-lead findings

### L1 — capture upload starves realtime

- Status: **partially confirmed; high severity**.
- Explains: the strong correlation with repeated captures, growing memory/JS pressure, and why the problem appears only after several successes.
- Evidence: baseline whole-file base64 + synchronous decode at `watchMemories.ts:19-27`; both still and polaroid use the same path at `:31-40`; full-HD PNG capture at `WatchRoomLayer.tsx:364-370`; non-cancelling timeout at `:324-332`.
- Limit: realtime-js normally turns a missed heartbeat into a channel error/reconnect, so upload pressure alone does not prove the reported no-recovery state.
- Fix: native signed-URL binary upload with status validation (`src/services/watchMemories.ts:43-111`). The 12-second responder deadline now starts before signed-URL creation, passes only the remaining budget to the native upload, rejects immediately at expiry, and cancels the native task best-effort (`:18-40,67-88,99-107`). No dependency or runtime change.

### L2 — socket dies with no status callback

- Status: **disproven as stated; residual defense gap confirmed; medium severity**.
- Explains: a half-open transport could otherwise leave the UI stale, but an ordinary heartbeat/socket close in this installed library does emit `CHANNEL_ERROR`.
- Evidence: vendor heartbeat/close propagation cited in the summary; baseline reconnect existed at `watchRoomService.ts:206-235`.
- Fix: server-acknowledged broadcasts and checked sends (`src/services/watchRoomService.ts:183-188,289-309`) plus a 20-second acked liveness probe (`:339-367`). Both paths preflight the public socket state before sending, so realtime-js cannot mask a dead receive path with its REST fallback (`:295,343`). Any failed/timed-out result enters reconnecting and coalesces through the existing single reconnect timer.

### L3 — token expiry on private channels

- Status: **partially confirmed; high severity for long sessions, not proven as this field trigger**.
- Explains: sends failing around token rollover, especially with app-wide `autoRefreshToken:false` (`src/services/supabase.ts:33-39`).
- Root cause: baseline used `< 60s`, so the timer waking at exactly the margin skipped refresh; the minimum next delay was another 60 seconds, at/after expiry (`watchRoomService.ts:280-297`). Refresh failure reused the stale token, and a null session/token returned without any retry.
- Disproved sub-lead: fresh `setAuth` does reauthorize joined channels in realtime-js 2.99.1 by pushing the new access token (`node_modules/@supabase/realtime-js/src/RealtimeClient.ts:850-903`).
- Fix: `<=` margin, awaited `setAuth`, 10-second retry after refresh/null-token failure, no timer reschedule after user close, and reconnect when auth is no longer usable (`src/services/watchRoomService.ts:358-407`; pure timer policy `src/utils/watchRoom.ts:169-182`).

### L4 — send silently drops/fails

- Status: **confirmed; critical**.
- Explains: chat and reactions stop in both directions while optimistic local UI hides the failure; capture signals can be asymmetric during a flap.
- Evidence: baseline `ack:false` and fire-and-forget result discard at `watchRoomService.ts:159-166,237-239`.
- Fix: `ack:true`, joined/socket-state gate, checked result, and guarded reconnect (`src/services/watchRoomService.ts:183-188,289-309`). Repeating playback/readiness messages may still be dropped during the first join, but they cannot tear down that in-progress join. No stale ICE/playback/capture queue was added.

### L5 — lobby/code UX after a mid-session loss

- Status: **confirmed; high severity**.
- Explains: the exact “Waiting for your partner” plus join code field symptom.
- Evidence: baseline transient history reset and render fallback at `WatchRoomLayer.tsx:190-206,566-574`; connection state was already exposed but ignored at `useWatchRoomSession.ts:258-267`.
- Fix: sticky “ever connected/ever had partner” history and a pure priority function (`src/utils/watchRoom.ts:126-146`; `WatchRoomLayer.tsx:191-213`). A local channel loss renders “Reconnecting…” with no code; an actual departure renders partner-left copy with no code; only the initial lobby shows the code (`WatchRoomLayer.tsx:578-604`).

### L6 — disconnected capture produces a one-photo card

- Status: **confirmed; critical**.
- Explains: the guest-only card after the connection/presence failure.
- Evidence: baseline initiation and button guards omitted transport/presence, and partner waiting was conditional on the already-false presence snapshot (`WatchRoomLayer.tsx:348-360,446-475,617-629`).
- Fix: a pure eligibility gate requires connected transport + partner + no active capture/cooldown (`src/utils/watchRoom.ts:148-162`; `WatchRoomLayer.tsx:205-212,458-484,630-645`). A connection drop while waiting aborts with “Capture interrupted” instead of saving a degraded card (`WatchRoomLayer.tsx:348-374`). Explicit privacy decline remains allowed.

### L7 — remaining white-screen paths

- Status: **prompt premise partly disproven; remaining risks confirmed; exact device trigger unproven; high severity**.
- Explains: a native dialog-window race or uncaught async/native failure can freeze the room despite the prior preview-Modal fix.
- Evidence: global boundary exists at `App.tsx:188-248,575-592`; baseline chat Modal, stream getter, player callback, and async risks are listed in the summary.
- Fixes:
  - chat is now an in-layer z20 overlay, below the z30 polaroid preview (`WatchRoomLayer.tsx:702-749,811-819`);
  - safe stream URL resolution falls back to placeholders during teardown (`FaceCamOverlay.tsx:33-46,58-70`);
  - released-player sync/heartbeat/ducking callbacks are guarded (`useWatchRoomSession.ts:68-95,201-253`; `useAudioDucking.ts:42-96`);
  - media setup failures are caught, cleaned up, and enter bounded restart (`useWebRtcPeers.ts:346-357`);
  - a room-scoped recovery boundary remounts or exits only Watch Together (`WatchRoomBoundary.tsx:1-58`; mount at `PlayerScreen.tsx:1391-1398`).

### L8 — WebRTC restart budget is exhausted by captures

- Status: **disproven as a room-channel cause**.
- Evidence: capture camera-off resets attempts (`useWebRtcPeers.ts:376-384` at baseline), successful media connect resets attempts (`:286-295`), TURN failure falls back to STUN (`src/services/turnCredentials.ts:24-43`), and the media hook does not mutate the Realtime service.
- Fix: no restart-budget change. Only the uncaught `setup()` rejection path was contained (`useWebRtcPeers.ts:346-357`). Media failure remains independently recoverable and cannot directly tear down the room channel.

## Automated coverage

- Pure transition tests: reconnect backoff, auth scheduling, stale-presence/reconnecting priority, permanent partner-left state, and capture eligibility (`tests/watchRoom.test.ts:127-197`).
- Architecture regression tests: end-to-end native/cancellable upload deadline, acknowledged sends/socket liveness, lifecycle generation, no Watch Together `Modal`, and room-scoped boundary (`tests/watchTogetherStabilityArchitecture.test.ts:1-40`).
- Native camera, WebRTC, Android window behavior, and actual socket/token rollover remain two-device checks.

Prepared-branch quality gates:

- `npm run typecheck` — passed.
- `npm test` — 230 passed, 0 failed.
- `npx eslint <touched files> --quiet` — passed with zero errors.
- `git diff --check` — passed (only the repository's existing Windows line-ending notices were printed).

## Post-review race hardening

The post-commit backend/orchestration review found four races that the first automated pass did not exercise; all were corrected before device handoff:

- A lifecycle generation is captured by connect/reconnect/auth work and invalidated first on disconnect. Every post-await continuation and channel callback checks it, so an in-flight authorization/removal cannot resurrect a room after exit (`src/services/watchRoomService.ts:67,145-176,209-228,312-333,375-376,396-414`).
- A successful library rejoin clears the service's pending manual reconnect timer before marking connected, so that timer cannot later tear down the recovered channel (`watchRoomService.ts:240-247`).
- Initial subscribe timeout nulls/removes that exact channel; late callbacks fail the channel identity/generation guard and cannot produce a ghost connected service behind a join-failed UI (`watchRoomService.ts:206-228`).
- The responder upload deadline covers signed-URL creation and native body upload; expiry rejects immediately even if `cancelAsync()` itself stalls (`watchMemories.ts:18-40,67-88,99-107`).

## Required two-device verification

1. Run both authenticated Android devices on the same new runtime-1.2.0 bundle; migration `20260710190000` must already be applied.
2. Alternate authorship for at least four captures, waiting through each cooldown. Every accepted card must contain both faces and preview on both phones.
3. Open/close chat during incoming captures and polaroid previews; verify no white or unresponsive window.
4. Enable airplane mode on each phone in turn for 20–30 seconds. The affected phone must show “Reconnecting…” with no join code, and capture must be disabled.
5. Restore networking and verify bidirectional chat, reactions, playback sync, and media recovery.
6. Have one partner explicitly leave. The remaining phone must show partner-left copy without the join code; rejoin must restore the ready state.
7. Keep a session alive beyond the project's real token TTL and repeat chat, reactions, sync, and capture after rollover.
8. Exit the player during camera handoff/upload/reconnect/preview and confirm there is no crash or stale native window.

## Compatibility and release status

No database, native dependency, runtime, or WatchRoom signal format changed. Old bundles ignore the service-only `liveness` event because it is not broadcast as a `signal`. Both devices should still receive the new bundle before verification so send acknowledgements, capture blocking, and recovery UI are symmetric.

Per `ENGINEERING.md` section 3, OTA publication is not allowed until the prepared bundle has been tested in Expo/on devices and the user explicitly says **go**. Commit/push may be prepared first; the EAS update group and deployed-state documentation must be recorded only after that gate.
