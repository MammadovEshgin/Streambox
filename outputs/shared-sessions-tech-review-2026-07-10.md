# Watch Together / Shared Sessions — Technical Audit (runtime 1.2.0)

Date: 2026-07-10 · Branch: `release/1.2.0-watch-together` · Scope: analysis only, no code changed.
Files audited: `useWebRtcPeers.ts`, `useWatchRoomSession.ts`, `useWatchRoom.ts`, `watchRoomService.ts`,
`turnCredentials.ts`, `webrtcCompat.ts`, `workers/turn-credentials/`, `WatchRoomLayer.tsx`,
`FaceCamOverlay.tsx`, `PolaroidCard.tsx`, `SharedSessionsSection.tsx`, `watchMemories.ts`,
`watchMemoryLocalStore.ts`, `watchMemoryCache.ts`, `utils/watchRoom.ts`, `WatchRoomScreen.tsx`,
`PlayerScreen.tsx` (integration points), all 5 `*watch*` migrations, ENGINEERING.md §2A.

---

## 1. Cross-network connectivity (WebRTC / NAT / TURN)

### F1. No ICE restart or network-change recovery — a network switch kills the call permanently — **Critical**
- **Scenario:** Either phone moves Wi-Fi ↔ cellular (leaving the house, elevator, Wi-Fi drop) mid-session. ICE goes `disconnected` → `failed`. The call never comes back until the user manually toggles cameras off/on — and nothing tells them to.
- **Why:** `useWebRtcPeers.ts` treats `connectionState === "failed"` as terminal (`onconnectionstatechange`, lines 190–195): it only sets React state. There is no `restartIce()`/`createOffer({ iceRestart: true })`, no `onnegotiationneeded`, and no `NetInfo`/network-change listener anywhere in the codebase (verified by grep). `handleSignal`'s catch also sets `failed` with no recovery.
- **Fix direction:** Listen for `iceconnectionstatechange === "disconnected"/"failed"`; host performs `createOffer({ iceRestart: true })` (guest sends a `webrtc-restart-request` signal so the host initiates). Subscribe to NetInfo and trigger a restart on network-type change. Re-fetch TURN creds before restarting.

### F2. Media failure is completely silent — no UI, no retry — **High**
- **Scenario:** TURN worker is down or `EXPO_PUBLIC_TURN_CREDENTIALS_URL` unset → `fetchIceServers()` silently returns Google STUN only (`turnCredentials.ts:17–33`). Both users behind symmetric/carrier-grade NAT (very common on mobile) → ICE fails. Both see grey placeholder tiles forever; the movie keeps playing; neither knows why "faces don't work".
- **Why:** `WatchRoomLayer.tsx` never consumes `session.mediaState` — `useWatchRoomSession` returns it (line 134) but no component renders it. `FaceCamOverlay` only distinguishes "stream present" vs "placeholder". `getUserMedia` failure (`useWebRtcPeers.ts:161–167`) also just sets `failed` silently.
- **Fix direction:** Surface `mediaState` on the tiles ("connecting…", "connection failed — tap to retry") with a manual retry (tear down + re-setup, fresh ICE creds). Log/telemetry the failure reason (selected candidate pair via `getStats()` would also confirm relay usage in the field).

### F3. Readiness handshake is fire-and-forget — a lost `webrtc-ready` wedges both peers in "connecting" — **High**
- **Scenario:** User taps camera-on within a second of entering the room, or the partner's Realtime channel is mid-flap. The single `webrtc-ready` broadcast is dropped. Host waits for a "ready" that never re-arrives; guest waits for an offer. Both sit in `connecting` forever.
- **Why:** Broadcast is `ack:false` with no persistence (`watchRoomService.ts:118`); `announceReady()` fires exactly once per enable (`useWebRtcPeers.ts:201`). Worse, `WatchRoomService.connect()` resolves after calling `.subscribe()` but **before** `SUBSCRIBED` lands (`watchRoomService.ts:134–143`), so sends immediately after join are dropped by realtime-js. There is no re-announce timer and no negotiation timeout.
- **Fix direction:** Re-announce `webrtc-ready` on an interval (e.g., every 2s) until the offer/answer exchange completes; add a negotiation timeout that resets to a clean retry. Gate first send on `SUBSCRIBED` (resolve `connect()` from the status callback).

### F4. Asymmetric peer-connection recreation (guest toggle / guest-initiated capture) relies on peer-reflexive luck — **High**
- **Scenario:** The **guest** toggles cameras off/on, or initiates a polaroid capture (its `setCamerasOn(false)→(true)` handoff destroys and recreates its `RTCPeerConnection`). The host hears `webrtc-ready` and re-offers **on its existing pc** (`useWebRtcPeers.ts:98–107` → `makeOffer`, line 81: `createOffer({})`, no `iceRestart`).
- **Why:** Without `iceRestart` the host does not re-gather; its `onicecandidate` never re-fires, and the candidates it trickled during the first negotiation are gone (nothing stores/replays them). The guest's brand-new pc therefore has **zero remote candidates** and can only connect if the host's connectivity checks toward the guest's candidates create a peer-reflexive pair. That works on relay/srflx paths sometimes; it is not a reliable protocol. (When the **host** is the one recreating, the new offer carries fresh ufrag = implicit ICE restart, so that direction is OK — the failure is one-sided.)
- **Fix direction:** On any peer-ready received after a connection existed, host should offer with `{ iceRestart: true }`. Alternatively define an explicit `webrtc-renegotiate` signal that makes **both** sides recreate their pcs so every reconnect is a clean first-time negotiation.

### F5. TURN credentials: 24 h TTL, fetched once per enable, unauthenticated worker — **Medium**
- **Scenario:** (a) Mid-call expiry: TTL is 86 400 s (`wrangler.jsonc` `CRED_TTL_SECONDS`), so a movie won't outlive creds — but if TTL is ever lowered, there is no refresh path and the relay dies mid-call with no ICE restart (see F1). (b) Worker down at join → silent STUN-only degradation (see F2). (c) The endpoint is a public unauthenticated GET (`workers/turn-credentials/src/index.js`); `ALLOWED_ORIGINS` is empty and native fetch sends no Origin anyway — anyone who finds the URL can mint 24 h relay creds and burn Cloudflare TURN bandwidth on your account.
- **Fix direction:** Require a lightweight bearer token (Supabase JWT verified via JWKS, or at minimum a static app secret + rate limit). Drop TTL to a few hours and refresh creds on every (re)negotiation/ICE restart. Cloudflare's response does include UDP/TCP/TLS transports — pass-through is fine — but verify `turns:...:443?transport=tcp` is present in production responses (needed for hotel/corporate networks that block UDP).

### F6. IPv6 / VPN / captive-portal behavior unverifiable, and zero diagnostics — **Low**
- **Why:** Everything rides react-native-webrtc defaults; there is no `getStats()`, no `onicecandidateerror`, no logging of the selected candidate pair. You cannot tell from the field whether relay is even used.
- **Fix direction:** Add a small stats probe after `connected` (candidate-pair type, RTT) into your metrics; helps every other finding in this section.

---

## 2. Audio quality & ducking

### F7. No explicit mic constraints; movie bleed-through echo is unmitigated — **High**
- **Scenario:** Both users on phone speakers (no headphones — the normal case). The movie audio from phone A's speaker enters A's mic and is transmitted to B, who hears their own movie doubled with ~100–300 ms offset. Voice also competes with movie audio.
- **Why:** `useWebRtcPeers.ts:161–162` requests `getUserMedia({ audio: true, ... })` — no `echoCancellation`/`noiseSuppression`/`autoGainControl` constraints; you're relying on library defaults. Crucially, WebRTC's **software AEC only cancels audio rendered through its own audio device module** (the partner's voice). The movie plays through expo-video/ExoPlayer on a separate stream — software AEC has no reference for it. Some devices' hardware AEC cancels all device output, many don't.
- **Fix direction:** Set constraints explicitly (`audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }`). Accept that movie bleed can't be "cancelled" and attack it with ducking (F9) + a lower default movie volume while mics are live + encourage headphones in UI copy.

### F8. No audio-session / audio-focus management on Android — **High**
- **Scenario:** Cameras on → react-native-webrtc's native module flips the device into `MODE_IN_COMMUNICATION`; on many devices this reroutes/attenuates media playback (movie suddenly quiet, or routed to earpiece), fights expo-video's audio focus, and behaves differently again on Bluetooth. Incoming phone call: the OS pauses the movie; if the guest was paused by the OS, the host's heartbeat keeps forcing `play()` every 3 s against the interruption (`useWatchRoomSession.ts:53`).
- **Why:** There is no `setAudioModeAsync`/InterruptionMode/audio-focus code anywhere (grep: no `Audio.`/`InterruptionMode` in PlayerScreen or session code), and no AppState/interruption handling (see F19).
- **Fix direction:** Decide the audio mode explicitly when cameras toggle (e.g., `InCallManager` or rn-webrtc's media options: force speakerphone, keep media stream type for the movie). Pause the sync tug-of-war during interruptions (suspend heartbeat application while app is not active).

### F9. Audio ducking (requested design) — proposal
- **Where it hooks in:** a new `useAudioDucking({ player, peerConnection, localStream, enabled })` inside `useWatchRoomSession`, active only while `camerasOn && mediaState === "connected"`.
- **Voice detection:** poll `pc.getStats()` every ~200 ms; read `audioLevel` from the remote `inbound-rtp`/`media-source` stats (supported by react-native-webrtc). Optionally OR-in the **local** mic level (`media-source` on the sender) so your own speech also ducks the movie.
- **State machine:** SILENT → (level > T_attack for 2 consecutive samples) → DUCKED → (level < T_release for 800–1200 ms) → restore. Ramp `player.volume` (expo-video) from the user's current volume `v0` to `v0 * 0.35` over ~150 ms, restore to `v0` over ~400 ms. Persist `v0` at duck start; never stack ducks; if the user changes volume while ducked, update `v0`.
- **Pitfalls to design against:**
  - **Feedback loop:** movie audio bleeds into the mic → detected as "speech" → duck → level drops → restore → movie loud again → re-trigger. Oscillation. Mitigate with hysteresis (T_attack ≈ 0.08–0.12 normalized, T_release ≈ 0.04), a minimum duck hold (~1.5 s), a max duty cycle (if ducking re-triggers > N times/30 s, raise T_attack adaptively), and noise suppression on (F7) which strips broadband movie audio fairly well.
  - **Both talking:** single duck state fed by `max(remoteLevel, localLevel)` — one restore timer, no double-duck.
  - **False triggers from loud movie scenes** (through the partner's mic): the partner's *transmitted* audio contains their movie bleed; their NS won't fully remove music/effects. The adaptive threshold above is the practical answer; a fancier option is only trusting remote `audioLevel` when the local player reports low output loudness (no API for that in expo-video — skip).
  - **Mic muted:** skip local VAD when `micEnabled === false`; remote side unaffected.

---

## 3. Local + cloud memory persistence

### F10. Cloud upload is fire-and-forget: no retry, no outbox — partner can permanently never receive the memory — **Critical**
- **Scenario / walkthrough:** `buildPolaroid` (`WatchRoomLayer.tsx:255–314`) saves locally (good), then runs a **detached** async IIFE: `uploadPolaroid → saveWatchMemory → updateLocalMemory`. Failure cases:
  - (a) Storage upload succeeds, row insert fails (network blip, token expiry): orphaned Storage object; local entry stays `cloudId: null` **forever** — nothing ever retries. The partner never gets the memory (their shelf reads only cloud rows).
  - (b) Insert succeeds but `updateLocalMemory` fails: local entry unreconciled → duplicate card (see F12); author's delete of the local card won't delete the cloud row.
  - (c) App killed / session left mid-upload: same as (a) — the "detached so it completes" comment is only true while the JS runtime lives.
  - Plain network failure at capture time (cinema-mode phones on bad Wi-Fi): every path `.catch(() => null)` — memory is author-local forever.
- **Why:** No outbox/queue; upload attempted exactly once, immediately, with all errors swallowed.
- **Fix direction:** Make the local store the **outbox**: entries with `cloudId: null` are pending work. On app launch / Shared Sessions load / session end, sweep pending entries and retry (upload if no `imagePath`, insert if no `cloudId`, reconcile). Make the upload idempotent by pre-generating the memory id client-side (or deterministic storage path from `localId`) so a retry after case (a) reuses the uploaded object instead of orphaning it. Persist `roomId/mediaType/tmdbId/positionSeconds/participantUserIds` in `LocalMemory` so the retry has everything it needs (today the local entry lacks these fields — the outbox needs them).

### F11. `participant_user_ids` comes from a presence snapshot — a presence flap silently cuts the partner out — **High**
- **Scenario:** Partner's Realtime channel is reconnecting at the moment of capture (backgrounded 30 s, elevator). `session.members` = [author]. The row is inserted with `participant_user_ids = [authorId]`. `listWatchMemories` filters `contains(participant_user_ids, [userId])` — the partner **never** sees the memory, and nothing repairs it.
- **Why:** `WatchRoomLayer.tsx:301` uses `session.members.map(...)` (live presence), not durable membership.
- **Fix direction:** Source participants from `watch_room_members` (fetch once per session via `fetchMembers(roomId)` — the method already exists in `watchRoomService.ts:83`) or set them server-side in a `save_watch_memory` RPC that reads the membership table. Same for nicknames.

### F12. Duplicate card window in the shelf (dedup only by reconciled cloudId) — **Medium**
- **Scenario:** Author captures; background insert completes; author opens Profile before `updateLocalMemory` writes the `cloudId` (or case F10-b where it never writes). `load()` (`SharedSessionsSection.tsx:68–131`) shows the cloud row (key `row.id`) **and** the local entry (key `localId`, `cloudId` null) → same polaroid twice; it flickers back to one after reconcile.
- **Why:** Dedup relies exclusively on `local.cloudId` matching a cloud row id. There is no secondary fingerprint.
- **Fix direction:** The clean fix is client-generated memory ids (see F10) so local and cloud share one id from birth. Cheap mitigation: also fuzzy-match unreconciled locals against cloud rows on (title, createdAt within a few seconds) and merge.

### F13. Offline shelf shows nothing despite local-first design — **Medium**
- **Scenario:** User opens Profile with no connectivity. `Promise.all([listLocalMemories(), listWatchMemories(...)])` rejects because the cloud call throws → `catch { setMemories([]) }` — the shelf renders empty even though every image is cached on disk.
- **Why:** `SharedSessionsSection.tsx:70–73` couples the two sources in one `Promise.all` with a single catch.
- **Fix direction:** Settle independently (`Promise.allSettled`); on cloud failure, render local entries (and previously-reconciled cached items) and skip `pruneCachedMemories` (pruning against a partial id list would be dangerous — today it's skipped by the catch, keep it that way explicitly).

### F14. Orphaned Storage objects: camera stills are never deleted; no cleanup for failed uploads or expired rooms — **Medium**
- **Scenario:** Every capture uploads 1–2 raw stills to `{room}/stills/…` (`uploadCameraStill`) used only transiently for the partner-still exchange. `remove_watch_memory` deletes **only** `image_path` (the polaroid). Stills accumulate forever. Also: polaroid objects from F10-a (upload OK, insert failed) are unreferenced; `watch_rooms`/`watch_room_members` rows for expired rooms are never deleted (no cron/job exists — `expires_at` only gates joins).
- **Fix direction:** A scheduled cleanup (pg_cron or an edge function): delete storage objects under rooms whose `expires_at` passed and that have no memory rows referencing them; delete expired room+member rows. Or delete the two stills right after the polaroid is composed (author knows both paths).

### F15. Stale partner still can be baked into the *next* polaroid; remote still may not be rendered at snapshot time — **Medium**
- **Scenario A (stale):** Capture #1 — partner's still arrives *after* the 5 s timeout; the polaroid builds with a placeholder. The late `capture-still` still sets `partnerStill` state. Capture #2 minutes later: `buildPolaroid`'s wait loop short-circuits instantly on the stale ref (`WatchRoomLayer.tsx:258–260`) → the new polaroid embeds the partner's **old** photo. (`clearCapture` only runs on preview dismiss / partner path — and a still arriving after dismiss re-populates state.)
- **Scenario B (blank):** The still URI arrives in time, but it is a **remote signed URL**; `captureRef` fires only 250 ms after the wait loop (`line 264`) with no image-load confirmation → half-loaded/blank partner photo in the saved PNG.
- **Fix direction:** Clear `partnerStill` at the start of `initiateCapture`; tag `capture-still` signals with the request's `at` timestamp and ignore mismatches. For B: download the still to a local file first (you already have `cacheMemoryFromUrl`) and/or wait for `onLoad` from the `Image` before `captureRef`.

### F16. 5 s partner-still budget is routinely too small — **Medium**
- **Scenario:** Partner's path is: receive request → camera handoff (~0.55 s release + 0.35 s settle + snap) → base64 read + Storage upload (multi-second on cellular uplink for an ~1 MB JPEG) → broadcast → author creates signed URL. The author only waits `PARTNER_STILL_TIMEOUT_MS = 5000` *after finishing its own snap*. On any slow uplink the polaroid ships with a placeholder even though everything succeeded moments later.
- **Fix direction:** Send the partner still **peer-to-peer** as a data-channel blob (no storage round-trip; you already have the RTCPeerConnection), or raise the budget and show "waiting for partner's photo…" with the option to finalize early. Even simpler: send a low-res base64 thumbnail in the broadcast itself (a 58 px photo area needs ~15 KB, within Realtime message limits).

### F17. Delete/edit escape hatches around the per-user model — **Low**
- **Why:** (a) `watch_room_memories_delete_own` RLS remains alongside the RPC — the **creator** can hard-DELETE the shared row directly (PostgREST), erasing the partner's copy and skipping the storage cleanup logic. (b) Storage `upsert: true` + member-write policy lets either member overwrite an existing memory's `image_path` object, silently altering the partner's saved polaroid.
- **Fix direction:** Drop the direct DELETE policy (force the RPC); drop `upsert: true` (paths are already timestamp+random unique) so objects are write-once.

### F18. Fallback to the volatile view-shot URI when caching fails — **Low**
- **Why:** `WatchRoomLayer.tsx:276`: if `cacheMemoryFromLocalUri` fails, the AsyncStorage entry points at `captureRef`'s temp file (app cache dir) — the OS can purge it, leaving an index entry with a dead image for an unsynced memory.
- **Fix direction:** Treat cache-copy failure as capture failure (surface it), or retry the copy in the outbox sweep (F10).

---

## 4. Sync robustness

### F19. Clock skew > 2 s ⇒ hard seek every heartbeat, forever — **High**
- **Scenario:** One phone's clock is off by 3 s (manual time, drifted RTC, no NTP). `projectRemotePosition` uses raw `Date.now()` deltas; drift computes > `hardSeekSeconds = 2` on **every** 3 s heartbeat → the guest seeks every 3 s → constant rebuffer/stutter loop. Same loop appears when the guest is buffering (its playhead stalls while the host's advances).
- **Why:** `SyncOptions.clockOffsetMs` exists in `utils/watchRoom.ts:97–104` but is **never measured or passed** — `applyRemotePlayback` (`useWatchRoomSession.ts:45–56`) calls `resolveSyncDecision(local, state, Date.now())` with defaults. No ping/pong RTT/offset estimation exists. There's also no seek cooldown, so buffer-induced drift re-seeks immediately.
- **Fix direction:** Add a `sync-ping`/`sync-pong` signal pair at session start (and periodically): offset ≈ ((t1−t0) − RTT/2) style estimate, median of 5 samples; pass as `clockOffsetMs`. Add a seek cooldown (don't hard-seek more than once per N seconds) and skip corrections while the local player reports buffering.

### F20. Host leaving ends the room silently; the guest is stranded — **Medium**
- **Scenario:** Host exits (or the host phone dies). `leave()` → `end_watch_room` (status `ended`). The guest keeps playing with no notice; heartbeats stop (playhead free-runs — acceptable); the "Waiting for your partner" pill reappears over the movie; if the guest later leaves and tries to rejoin the code: "room not found or expired". No host-migration, no "host left" message.
- **Why:** `useWatchRoom.leave` (lines 167–175); nothing observes the partner's presence-leave or the room's status change to tell the guest.
- **Fix direction:** Minimal: watch presence-leave of the host and show "Host left — playback is now unsynced" with a dismiss. Nicer: promote the guest to sync authority (they're alone, so authority is moot — the message is the important part) and don't end the room on host exit until expiry, so the pair can re-form.

### F21. Heartbeat effect re-registers on every render (dep on the whole hook object) — **Medium**
- **Scenario:** Host side, any state change (a reaction, a chat message, presence sync, connection-state change) re-renders `useWatchRoomSession` → the effect at `useWatchRoomSession.ts:98–114` re-runs (its dep array includes `room`, the **object literal returned fresh by `useWatchRoom` each render**) → `clearInterval` + re-subscribe + an immediate `broadcast()`. During active chatting the host broadcasts far more often than every 3 s, and the 3 s interval keeps resetting.
- **Why:** `useWatchRoom` returns a new object every render; the effect deps should be the stable callbacks (`room.sendPlayback`) not the container.
- **Fix direction:** Depend on `[room.isHost, player, room.sendPlayback]` (wrap `sendPlayback` in `useCallback` — it already is) or hold the service in a ref.

### F22. Host seeks propagate only via the 3 s heartbeat; different encodes offset content — **Low**
- **Why:** Only `playingChange` has a listener; a seek while playing shows up on the next tick (up to 3 s + the 2 s threshold ≈ 5 s divergence window). Separately, since **each phone resolves its own stream** (per §2A), encodes with different intro offsets put the same `positionSeconds` at different frames — numeric sync converges, content doesn't. No detection exists.
- **Fix direction:** Broadcast immediately on `timeUpdate` jumps > threshold (or listen to a seek event if expo-video exposes one). Content-offset across providers is a hard problem — at minimum log both resolved stream URLs per room so support can diagnose "we're 10 s apart" reports.

---

## 5. Signaling / session lifecycle

### F23. No AppState handling at all: backgrounding, screen lock, incoming calls — **High**
- **Scenario:** Partner backgrounds the app or locks the screen. Android closes the camera (frozen last frame or black on the author's side); mic behavior is device-dependent (no foreground service is configured for the call); on return, nothing renegotiates — the video track may stay muted/frozen. Incoming phone call: same, plus the audio-focus fight from F8. If the OS kills the app, the peer only learns via presence timeout (~tens of seconds of frozen tile).
- **Why:** Grep confirms no `AppState` listener in any watch-together file; the pc/stream lifecycle is tied solely to `camerasOn` and unmount.
- **Fix direction:** On `AppState → background`: stop tracks / set `camerasOn=false` (announce a `camera-paused` signal so the partner gets a proper placeholder instead of a frozen frame). On foreground: re-enable and rely on the (fixed, F3/F4) readiness handshake. Long-term: Android foreground service (mediaProjection/microphone type) if you want calls to survive backgrounding.

### F24. Join is one-shot with all errors swallowed — dead session screen — **High**
- **Scenario:** `WatchRoomLayer` mounts inside PlayerScreen; `joinAndConnect` fails (transient network, room expired between the setup screen and player mount, second device of the same user racing). `joinedRef` is already `true`; the error vanishes (`useWatchRoomSession.ts:89–95`: `.catch(() => undefined)`). The user watches alone with a "Waiting for your partner" pill that can never resolve; the partner can't see them; no retry, no message.
- **Why:** One-shot guard + swallowed rejection; `connectionState`/`room === null` are never surfaced as an error state in `WatchRoomLayer`.
- **Fix direction:** Keep the idempotent-join guard but store failure state, show a "Couldn't join the room — retry" affordance, and reset `joinedRef` on retry. Also treat `connectionState === "error"` (from `CHANNEL_ERROR`/`TIMED_OUT`) the same way.

### F25. Channel flap recovery is unowned; in-flight signals are lost with no replay — **High**
- **Scenario:** Supabase Realtime socket drops (common on mobile). realtime-js will retry the socket, but: (a) whether the channel re-**tracks presence** after rejoin isn't handled by this code (members may vanish from the roster until something re-tracks — needs verification); (b) every broadcast sent during the gap is gone forever. Lost `webrtc-offer/answer/ice` → media never connects (until camera re-toggle); lost `capture-still` → polaroid missing partner photo; lost chat → silent message drop. Playback heartbeats are the only self-healing signal (periodic).
- **Why:** `watchRoomService.ts:134–143` maps statuses to UI state only; no re-subscribe/re-track logic; `broadcast` has no ack (`ack:false`) and no application-level retry/sequence numbers.
- **Fix direction:** On `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` while the session is supposed to be live: remove + recreate the channel and re-`track()`. Give the WebRTC handshake its own retry loop (F3) so signaling loss is survivable. Chat that matters could get a tiny seq/ack scheme or be accepted as lossy.

### F26. Guest leave never frees the seat; nickname-refresh join quirk — **Low**
- **Why:** Only the host's `leave()` ends a room; a guest's membership row persists (by design for reconnects), so a room can never be re-shared with a different person; fine for the private-pair product intent, but worth stating. `join_watch_room` (relax-nicknames migration) allows duplicate nicknames — two "Sam"s render identically in the polaroid labels and chat.
- **Fix direction:** Accept as designed, or add a `leave_watch_room` RPC that deletes membership when a guest explicitly exits from the lobby.

### F27. Capture handoff edge cases — **Medium**
- **Scenario:** During `captureSelfPhoto` (`WatchRoomLayer.tsx:213–240`): if the expo-camera never signals ready, the 4.5 s net resolves `null` and the polaroid ships with a placeholder self-photo — but `session.setCamerasOn(true)` is restored on a 400 ms timer regardless. If the app is mid-rotation, or camera permission was revoked in Settings mid-session ("Only this time" permissions on Android 11+), re-enable fails at `getUserMedia` → `failed` state → silent placeholder tiles (F2 again). Simultaneous captures by both users: both set `authorRef=true`, neither answers the other's `capture-request`, both time out → each polaroid gets only its own photo (graceful, but 10 s of "capturing" spinner each).
- **Fix direction:** Cover with F2's visible media state + retry; on `captureSelfPhoto` returning null, tell the author ("couldn't take your photo") instead of silently composing placeholders; consider first-writer-wins arbitration for simultaneous captures (compare `at` timestamps).

---

## 6. Security / abuse

### F28. The Realtime channel is not private — the room code alone grants full signal access, even to non-members — **High**
- **Scenario:** The channel name is derived from the code (`watchRoomChannelName`, `utils/watchRoom.ts:199–201`) and is a **default (non-private) broadcast channel** (`watchRoomService.ts:116–121` — no `private: true`). Anyone with the app's anon key and the code (shoulder-surfed, screenshotted invite, forwarded deep link) can subscribe and (a) eavesdrop chat/reactions/signals, (b) inject arbitrary signals — **without ever calling `join_watch_room`**, so the 2-member cap and membership RLS never apply. A full room does not protect the channel.
- **Why:** Supabase Realtime broadcast/presence on public channels is not gated by any RLS; only *database* reads were secured.
- **Fix direction:** Use Realtime **private channels** (`config: { private: true }`) + RLS on `realtime.messages` that checks `is_watch_room_member` against the topic; this makes membership the capability, not code knowledge. (Requires keeping `setAuth` fresh — already done.)

### F29. `capture-request` silently photographs a partner whose camera is OFF — **High (privacy)**
- **Scenario:** Partner has face-cam off (explicit privacy choice) but granted camera permission earlier. Author taps capture → partner's effect (`WatchRoomLayer.tsx:325–334`) runs `contributeStill()` unconditionally → hidden `CameraView` snaps their face and uploads it to Storage. No consent moment, no visible indicator beyond a brief spinner. Combined with F28, a channel intruder can trigger photo capture+upload of a victim (they can't read the object thanks to Storage RLS, but the capture itself happens).
- **Why:** The partner-side capture path never checks `session.camerasOn` or asks.
- **Fix direction:** Only auto-contribute when `camerasOn === true`; otherwise either skip (placeholder) or show a 3 s "Partner wants a polaroid — join the photo?" prompt. This also naturally rate-limits intruder-triggered captures.

### F30. Signal payloads fully client-trusted: spoofable `from`, playback control from anyone — **Medium**
- **Scenario:** The guest applies **any** `playback` signal without checking the sender is the host (`useWatchRoom.ts:69–71` passes `signal.from` but `useWatchRoomSession`'s `onPlayback` ignores it). Any channel participant (or intruder per F28) can teleport/pause the guest's playback. `from` is client-set, so the `payload.from !== self.userId` de-dup filter is trivially bypassed and chat can be impersonated.
- **Fix direction:** Check `fromUserId === room.hostUserId` before applying playback; after F28's private channels, spoofing requires membership, which reduces this to partner-level mischief.

### F31. Room-code generation and join brute force — **Medium**
- **Why:** Codes come from `Math.random()` (`utils/watchRoom.ts:25–36`) — not a CSPRNG; V8's xorshift state is recoverable from outputs in principle, and seeds correlate. Space is 31⁶ ≈ 887 M, rooms live 12 h, and `join_watch_room` / channel subscriptions have **no rate limiting**, so online guessing is bounded only by Supabase's tolerance. Also: a code collision on create surfaces as a generic error (unique violation) with no regenerate-retry.
- **Fix direction:** Use `expo-crypto` `getRandomBytesAsync` for code generation; add a retry-on-unique-violation loop in `createRoom`; consider per-user join-attempt throttling in the RPC (count failures in a small table) — cheap and kills bulk guessing.

### F32. Storage/RLS review — mostly solid, two nits — **Low**
- **Good:** private bucket; member-scoped read/write by folder; participant-based durable read policy (20260709120000) correctly survives room expiry; `remove_watch_memory` is per-user with last-out purge and the resilient-delete wrapper (20260709160000) prevents rollback on storage errors.
- **Nits:** (a) F17's direct-DELETE policy and `upsert:true`; (b) storage objects for rooms are readable by *members* even for stills of a capture the member wasn't part of — harmless with 2 members; (c) `is_watch_room_member` matches even after `expires_at` (membership rows persist) — intentional-looking, but note that "RLS after room expiry" therefore never actually revokes anything until rows are deleted (which nothing does — F14).

---

## 7. Resource & cost

### F33. No video constraints or bitrate caps — full-resolution camera streamed into a 122 px tile — **Medium**
- **Why:** `getUserMedia({ video: { facingMode: "user" } })` takes device-default resolution/framerate; no `RTCRtpSender.setParameters({ encodings: [{ maxBitrate }] })`. On TURN-relayed calls this is relay egress you pay for (Cloudflare TURN bills beyond free tier) and battery/thermal cost on 2-hour movies — for a face bubble that renders at 122 px.
- **Fix direction:** Constrain capture (`width: 480, height: 480, frameRate: 15–24`) and cap `maxBitrate` ~300–400 kbps; also lowers the odds of ICE failure on constrained networks.

### F34. Message volume & minor leaks — **Low**
- **Why:** Heartbeat 3 s = ~1 200 msgs/h/room, plus F21's per-render re-broadcasts; `chatMessages` grows unbounded in memory (fine for a movie); base64 upload path holds PNG + base64 string + ArrayBuffer simultaneously (~3× a 3–5 MB PNG) — survivable but spiky on low-RAM devices; `authTimer` cleared correctly; reaction `setTimeout`s can fire after unmount (harmless setState-on-unmounted warnings at worst); `Dimensions.get` memo won't track rotation (cosmetic).
- **Fix direction:** Fix F21; consider heartbeat 5 s with immediate broadcasts on transport changes; stream upload via `FileSystem.uploadAsync` to a signed upload URL to skip base64 if it ever shows up in OOM reports.

---

## Prioritized punch-list

1. **F10 + F11 — memory outbox + durable participants.** The product promise is "both users keep the memory"; today any hiccup breaks it permanently and invisibly. Client-generated ids + retry sweep + membership-table participants.
2. **F2 + F24 + F3 — kill the silent failures.** Surface `mediaState` and join errors with retry; make `webrtc-ready` re-announce until negotiated; gate sends on SUBSCRIBED. These three turn "it randomly doesn't work" into "it recovers or tells you".
3. **F28 + F29 + F30 — private Realtime channels, consent for camera-off capture, host-only playback authority.** The privacy one (F29) is small to fix and reputationally the worst bug in the feature.
4. **F1 + F4 + F23 — reconnect story:** ICE restart on failure/network change, explicit both-sides renegotiation signal, AppState pause/resume of media.
5. **F19 — clock-offset ping/pong + seek cooldown** (visible quality: stops the 3 s stutter loop on skewed clocks).
6. **F7 + F8 + F9 — audio:** explicit mic constraints, audio-focus handling, then the ducking hook.
7. **F12 + F13 — shelf correctness** (dupes, offline).
8. **F31 + F5 — abuse hardening:** CSPRNG codes, join throttling, authenticated TURN worker.
9. **F14 + F16 + F15 + F33 — cleanup job, partner-still transport/budget, stale-still fix, bitrate caps.**
10. Rest (F17, F18, F20, F21, F22, F26, F27, F32, F34) as follow-ups.

## Could NOT verify from code — needs a real 2-device test

- Whether the **guest-side pc recreation** (F4) actually reconnects via peer-reflexive candidates on TURN vs STUN paths — the analysis says "fragile", real behavior may be better or worse per device.
- Whether **supabase-js re-tracks presence** automatically after a channel auto-rejoin (F25) — version-dependent.
- react-native-webrtc's **default AEC/NS/AGC** state on your target Android devices, and whether hardware AEC cancels expo-video output (F7).
- The actual **audio focus / routing** interplay between ExoPlayer (expo-video) and WebRTC's `MODE_IN_COMMUNICATION` (F8) — very device-dependent.
- Whether Cloudflare's returned ICE set includes **turns:443/TCP** in production (F5) and whether relay is actually selected on carrier-grade NAT (needs `getStats` on-device).
- Real-world timing of the **capture handoff** (camera release/acquire latencies, the 550/350/400 ms sleeps) across device tiers (F27, F16).
- Whether `player.play()` during a phone-call interruption actually fights the OS or is ignored by ExoPlayer (F8/F23).
