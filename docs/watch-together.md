# Watch Together — architecture

A private, **2-person Watch Room**: two people watch the same movie in sync, see each other's
faces over the video, talk, react, chat, and capture polaroid "memories" that land on both
profiles. Rooms are joined by **code**, not a friend graph. Operational rules and gotchas live
in `ENGINEERING.md` §5; this document describes how the pieces fit together.

---

## 1. Transport — media never touches Supabase

```
   Phone A  ── WebRTC media (camera + mic), direct P2P ──────────►  Phone B
      │                                                                │
      └──────────►  Supabase Realtime channel (tiny messages)  ◄───────┘
                    · WebRTC signalling (offer / answer / ICE / ready)
                    · playback heartbeat + clock sync
                    · chat · reactions · capture flow · presence
                          │
      Cloudflare Worker ──┘ (only at call setup: mints short-lived TURN credentials)
      Supabase Postgres / Storage: durable room state + saved polaroids
```

- **Media**: `react-native-webrtc` peer-to-peer (`src/hooks/useWebRtcPeers.ts`). STUN first,
  **Cloudflare Realtime TURN** as relay when carrier NAT blocks a direct path.
- **TURN credentials**: `src/services/turnCredentials.ts` calls `workers/turn-credentials`
  (`EXPO_PUBLIC_TURN_CREDENTIALS_URL`) with the user's Supabase access token. The Worker only
  mints for a signed-in user; without a session the call falls back to STUN only.
- **Signalling**: `WatchRoomSignal` messages on the room's Realtime channel
  (`watchRoomChannelName(code)`), a `private: true` channel authorized by two
  `realtime.messages` RLS policies that check room membership.
- Everything on the channel is sub-kilobyte, well inside Supabase's free-tier Realtime limits.

## 2. Rooms and nicknames

- 6-character codes from an unambiguous alphabet (`generateRoomCode`); share link
  `streambox://room/<code>`.
- The user picks a **session nickname** (unique within the room, case-insensitive; the last one
  is remembered).
- RPCs `create_watch_room` / `join_watch_room` / `end_watch_room` (SECURITY DEFINER) look rooms
  up by code, enforce the 2-member cap and nickname uniqueness, and are idempotent on reconnect.
  Tables: `watch_rooms`, `watch_room_members`, `watch_room_memories` (see the baseline schema).
  The daily `watch-together-cleanup` cron removes expired rooms.
- Entry point: the movie detail screen. Movies only; the in-player episode picker is disabled
  inside rooms.
- **The host can start alone.** Playback is never blocked while waiting; the "Waiting for your
  partner" card is non-interactive, and a guest who joins later jumps to the host's position.

## 3. Playback sync — host-authoritative clock

Each phone resolves **its own** stream (they may land on different providers), so sync is by
content timecode:

- The host broadcasts a `playback` heartbeat (`isPlaying`, `positionSeconds`,
  `updatedAtEpochMs`) on an interval, on play/pause, and immediately on a seek jump.
- The guest measures the host clock offset with `sync-ping` / `sync-pong` (median of 5),
  projects where the host should be, and hard-seeks only when drift exceeds 2s — with a 5s
  cooldown and never while buffering. Transport (play/pause) is reconciled separately, and
  playback signals are accepted only from the host.
- If the guest's stream fails to resolve, the room stays alive as a social channel.
- The sync math is pure and unit-tested in `src/utils/watchRoom.ts` / `tests/watchRoom.test.ts`.

## 4. Connection lifecycle

- `webrtc-ready` gates the host's offer so it cannot arrive before the guest's peer
  connection exists; it is re-announced every 2s until SDP lands. Early offers are queued.
- Offers use `iceRestart`; failed or stuck connections rebuild up to 3 times, then the partner
  tile shows "Tap to retry".
- Realtime sends use server acknowledgements; a 20s liveness probe requires an open socket.
  Auth refreshes before expiry and reconnects when the token is unusable.
- Audio: explicit echo cancellation / noise suppression / AGC; face-cam capped at 640×480@24,
  400 kbps; the movie volume ducks while someone talks (`useAudioDucking`).

## 5. Polaroid memories

1. A user taps **Capture** → `capture-request`. If the partner's camera is off they answer
   `capture-unavailable`. Capture requires both people present and a connected channel;
   there is a shared 30s cooldown.
2. Each phone takes a still with `expo-camera` by briefly handing the camera off from WebRTC
   (screenshots of `RTCView` come out black), uploads it to the private `watch-memories`
   bucket via a signed upload URL and native binary upload, and sends `capture-still`.
3. The author composes `PolaroidCard` (code/SVG, captured at 1080×1451) and sends
   `polaroid-preview` so the partner sees the finished card.
4. The memory is saved local-first (PNG + AsyncStorage) and uploaded in the background with a
   client-generated UUID; `syncPendingMemories()` retries idempotently. The cloud row lists
   both `participant_user_ids` (taken from `watch_room_members`), so it appears on both
   profiles' **Shared Sessions** shelf.
5. Deleting removes only the caller (`remove_watch_memory`); the row and file are purged when
   no participant remains.

## 6. Wire protocol

`WatchRoomSignal` in `src/utils/watchRoom.ts`:

| type | when | payload |
|------|------|---------|
| `webrtc-offer` / `webrtc-answer` | connection setup | `sdp` |
| `webrtc-ice` | connection setup | `candidate` |
| `webrtc-ready` | peer connection ready for an offer | — |
| `playback` | heartbeat + transport change | `RemotePlaybackState` |
| `sync-ping` / `sync-pong` | guest clock-offset measurement | `t0` (+ `t1`) |
| `reaction` | emoji tap | `emoji`, `at` |
| `chat` | message sent | `text`, `at` |
| `capture-request` | polaroid requested | `captureId`, `at` |
| `capture-still` | a still is uploaded | `captureId`, `nickname`, `imagePath`, `at` |
| `capture-unavailable` | partner's camera is off | `captureId` |
| `polaroid-preview` | finished card uploaded | `captureId`, `imagePath` |

Every message also carries `from`. Changing a payload shape requires both devices to run the
new bundle.

## 7. Setup for a new environment

1. Cloudflare Realtime TURN key → `wrangler secret put TURN_KEY_ID` and `TURN_KEY_API_TOKEN` on
   `workers/turn-credentials`; set `SUPABASE_URL` in its `wrangler.jsonc`; deploy; put the URL
   (+ `/ice`) in `EXPO_PUBLIC_TURN_CREDENTIALS_URL`.
2. Build the database from `supabase/migrations/` — the baseline creates the tables, RPCs and
   `watch-memories` bucket; `20260916211341_restore_watch_room_realtime_policies.sql` adds the
   channel policies.
3. A 1.2.0 EAS build is required: the native WebRTC and camera modules cannot arrive over OTA.
