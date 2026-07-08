# Watch Together — architecture & build plan

Private, 2-person **Watch Room**: two people watch the same title in sync, see
each other's faces over the video, talk, and capture a polaroid "memory" of the
moment. Accounts stay independent — a room is joined by a **code**, not a
friend graph.

This document is the contract the client, backend, and infra are built against.
It also tracks what is already in the repo vs. what is still to build.

---

## 1. The one thing to understand about performance

**Camera and mic never travel through Supabase.** Live video/audio rides
**WebRTC**, phone-to-phone (peer-to-peer). Supabase only carries small text
messages: the WebRTC "let's connect" handshake, playback sync heartbeats, chat,
reactions, and presence. Those are sub-kilobyte payloads with sub-second
delivery, far under the free-tier ceilings (200 concurrent connections, 2M
messages/month) for 2-person rooms. So Supabase free tier is **not** the
bottleneck — the movie sync and face-cam are fast because the heavy media is on
a direct P2P link, not on Supabase.

```
   Phone A  ── WebRTC media (camera + mic), direct P2P ──────────►  Phone B
      │                                                                │
      └──────────►  Supabase Realtime channel (tiny messages)  ◄───────┘
                    · WebRTC signaling (offer/answer/ICE)
                    · playback heartbeat (play/pause/position)
                    · chat · reactions · presence (lobby)
                          │
      Cloudflare Worker ──┘ (only at call setup: mints short-lived TURN creds)
      Supabase Postgres/Storage: durable room state + saved polaroids
```

---

## 2. Runtime isolation (why old APKs are safe)

Watch Together adds native modules (`react-native-webrtc`, `expo-camera`). Per
`ENGINEERING.md §2`, native additions cannot go OTA and require a new
`runtimeVersion`. This feature lives on a **third runtime, `1.2.0`**
(`app.config.js`), built from branch `release/1.2.0-watch-together`.

EAS Update delivers a bundle only to installs on the matching runtime, so:

- The **1.0.2 legacy** fleet and the **1.1.0 nav-bar** fleet can never receive
  a 1.2.0 bundle → they can't be handed code that calls camera/WebRTC modules
  they don't ship → **old APKs cannot break.**
- 1.2.0 is its own OTA track. It never receives 1.0.2/1.1.0 updates and vice
  versa.

This branch is **not** ported back to the older release branches.

---

## 3. Media transport — Raw WebRTC P2P (+ Cloudflare TURN)

Chosen over a managed SFU (LiveKit) because the room is exactly 2 people:
direct peer-to-peer is the lowest-latency, lowest-cost topology and reuses
infra already in the stack (Supabase for signaling, Cloudflare for TURN).

- **Client:** `react-native-webrtc` — `RTCPeerConnection`, local camera/mic via
  `mediaDevices.getUserMedia`, remote stream rendered with `RTCView`.
- **Signaling:** exchanged as `WatchRoomSignal` messages over the room's
  Supabase Realtime channel (`webrtc-offer` / `webrtc-answer` / `webrtc-ice`).
- **NAT traversal:** STUN (public) first; **Cloudflare Realtime TURN** relay as
  fallback. Ephemeral TURN creds come from `workers/turn-credentials`
  (`EXPO_PUBLIC_TURN_CREDENTIALS_URL`) so the API secret never ships in the app.
- **Audio while watching:** open mic with WebRTC's built-in echo cancellation,
  plus a mute toggle. (Push-to-talk can come later if the movie audio bleed is
  a problem in testing.)

---

## 4. Playback sync — host-authoritative clock

The movie itself is **not** shared as a file — each phone resolves its own
stream via `WebPlayerService` (they may land on different providers/qualities),
so sync is by **content timecode**, mirroring `useContinueWatching`'s approach.

- The **host** samples its `expo-video` playhead and broadcasts a `playback`
  heartbeat (`{ isPlaying, positionSeconds, updatedAtEpochMs }`) every
  `WATCH_ROOM_HEARTBEAT_INTERVAL_MS`, and immediately on any play/pause/seek.
- The **guest** projects where the host should be now
  (`projectRemotePosition`) and applies `resolveSyncDecision`: hard-seek only
  when drift exceeds `WATCH_ROOM_DEFAULT_HARD_SEEK_SECONDS` (2s), otherwise
  leave the playhead alone to avoid stutter. Transport (play/pause) is
  reconciled independently.
- All of this math is pure and unit-tested in `src/utils/watchRoom.ts` /
  `tests/watchRoom.test.ts`.
- **Graceful degrade:** if the guest's stream fails to resolve, the room stays
  alive as a social channel (faces, chat, reactions, polaroid) — playback sync
  just goes idle for that side.

> Clock skew: `resolveSyncDecision` accepts a `clockOffsetMs`. v1 assumes ~0
> (NTP-close phones); a ping/pong round-trip over the channel can measure and
> feed a real offset later if needed.

---

## 5. Nicknames & rooms

- Before joining, the user picks a **session nickname** (not their account
  name), validated by `isValidNickname` / `isNicknameAvailable` — unique within
  the room, case-insensitive. Last nickname is remembered
  (`WATCH_TOGETHER_NICKNAME_STORAGE_KEY`) to prefill.
- **Create/join by code.** Codes are 6 chars from an unambiguous alphabet
  (`generateRoomCode`). Sharing also works via deep link
  `streambox://room/<code>` (the app already registers the `streambox` scheme).
- Backend: `create_watch_room` / `join_watch_room` / `end_watch_room` RPCs
  (SECURITY DEFINER) look rooms up by code across RLS, enforce the 2-member cap
  and nickname uniqueness, and are idempotent on reconnect. Tables + membership
  RLS: `supabase/migrations/20260708120000_create_watch_together_platform.sql`.

---

## 6. Polaroid memories

The polaroid is composed from **camera stills**, never a screenshot — a
screenshot can't capture the live camera or DRM video texture (same reason we
never screenshot the movie).

Flow:
1. Either user taps **Capture** → `capture-request` broadcast; partner is
   prompted to agree.
2. On agreement, each phone snaps a still from its own camera
   (`expo-camera` `takePictureAsync`) and uploads it to the private
   `watch-memories` Supabase Storage bucket under `{room_id}/…`; the path is
   shared via `capture-still`.
3. A polaroid view is composited (poster/backdrop + both stills + nicknames +
   movie title + timecode + date + design) and rasterized with
   `react-native-view-shot` — the exact `captureRef → PNG → Sharing` pattern
   already used by `ViewerPersona`'s share card.
4. The memory row is written to `watch_room_memories` with both
   `participant_user_ids`, so it shows on **both** accounts' "Movie Memories"
   shelf even after the room expires. Export/share via `expo-sharing`.

---

## 7. Wire protocol

`WatchRoomSignal` (in `src/utils/watchRoom.ts`) is the typed contract for every
message on a room's Realtime channel (`watchRoomChannelName(code)`):

| type | when | payload |
|------|------|---------|
| `webrtc-offer` / `webrtc-answer` | connection setup | `sdp` |
| `webrtc-ice` | connection setup | `candidate` |
| `playback` | heartbeat + on transport change | `RemotePlaybackState` |
| `reaction` | user taps an emoji | `emoji`, `at` |
| `chat` | user sends a message | `text`, `at` |
| `capture-request` | user wants a polaroid | `at` |
| `capture-still` | a phone's still is uploaded | `nickname`, `imagePath`, `at` |

---

## 8. Credentials / setup you must provide

1. **Cloudflare Realtime TURN** key → set `TURN_KEY_ID` + `TURN_KEY_API_TOKEN`
   as secrets on `workers/turn-credentials`, deploy it, and put its URL in
   `EXPO_PUBLIC_TURN_CREDENTIALS_URL`.
2. **Apply the migration** `20260708120000_create_watch_together_platform.sql`
   to Supabase (manually — never `db push`). This also creates the
   `watch-memories` Storage bucket + policies.
3. **Enable Supabase Realtime** for the project (broadcast/presence are on by
   default; confirm the anon role can use Realtime).
4. Handle the `autoRefreshToken: false` client setting: the room session must
   keep the Realtime socket authorized (call `supabase.realtime.setAuth` on a
   timer, or refresh the token while a room is active).
5. `npx expo install react-native-webrtc expo-camera @config-plugins/react-native-webrtc`
   then a fresh **EAS dev/preview build** (runtime 1.2.0) — native modules can't
   run in Expo Go or over OTA.

---

## 9. Build phases

- [x] **Phase 1 — Foundation (this branch, done):** isolated runtime 1.2.0 +
  native plugins/permissions; deps; module shims; backend schema + RLS + RPCs +
  Storage bucket; TURN-credentials Worker; pure sync/code/nickname core with
  unit tests; this doc.
- [ ] **Phase 2 — Signaling & sync engine (pure-JS, testable):**
  `WatchRoomService` (Realtime channel: presence + broadcast, token refresh),
  `useWatchRoom` hook, host-clock heartbeat wired to the existing player.
- [ ] **Phase 3 — WebRTC media:** `useWebRtcPeers` (getUserMedia, peer
  connection lifecycle, ICE via the TURN Worker, reconnection), face-cam
  overlay (top-right + bottom-right, ~30%).
- [ ] **Phase 4 — UI & polish:** nickname sheet, create/join + lobby, deep
  links, in-session chat sheet + floating reactions, capture flow + polaroid
  compositor, "Movie Memories" shelf, badges ("First Watch Room", "Movie
  Night"). Clean/modern visual pass (Reanimated + SVG; Rive reserved for one or
  two hero moments).

## 10. Open questions

- Do we gate Watch Together behind a minimum connection quality / show a
  "connecting…" state while ICE negotiates?
- Group rooms (3+) later would mean revisiting P2P mesh vs. an SFU.
- Moderation/abuse posture before any "public rooms" idea.
