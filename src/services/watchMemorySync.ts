import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import { supabase } from "./supabase";
import { saveWatchMemory, uploadPolaroid } from "./watchMemories";
import { listLocalMemories, updateLocalMemory } from "./watchMemoryLocalStore";

// Watch Together — memory upload OUTBOX. A polaroid is saved locally the
// instant it is captured; getting it to the cloud (so the PARTNER's shelf
// shows it too) used to be a single fire-and-forget attempt. This sweep
// retries every entry still carrying a `pending` payload until its cloud row
// is confirmed, resuming exactly where the last attempt died:
//   no imagePath  → upload the cached PNG (deterministic path — re-upload
//                   overwrites, never orphans), then
//   no cloudId    → insert the row under the client-generated id (a duplicate
//                   insert reads as a 23505 conflict = success).
// Runs on Shared Sessions load and after every capture; single-flight.

// After this long we stop retrying (the expired room rows that the insert's
// RLS check needs get cleaned up server-side) — the memory stays on-device.
const GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

let inFlight: Promise<void> | null = null;

export function syncPendingMemories(): Promise<void> {
  if (!inFlight) {
    inFlight = runSweep().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function runSweep(): Promise<void> {
  const all = await listLocalMemories();
  for (const entry of all) {
    if (!entry.pending || entry.cloudId) continue;

    if (Date.now() - entry.createdAtEpochMs > GIVE_UP_AFTER_MS) {
      await updateLocalMemory(entry.localId, { pending: null }).catch(() => undefined);
      continue;
    }

    try {
      let imagePath = entry.imagePath;
      if (!imagePath) {
        const info = await FileSystem.getInfoAsync(entry.imageLocalUri);
        if (!info.exists) {
          // The only copy of the image is gone — nothing left to sync.
          await updateLocalMemory(entry.localId, { pending: null }).catch(() => undefined);
          continue;
        }
        imagePath = await uploadPolaroid(entry.pending.roomId, entry.localId, entry.imageLocalUri);
        await updateLocalMemory(entry.localId, { imagePath }).catch(() => undefined);
      }

      const cloudId = await saveWatchMemory({
        id: entry.localId,
        roomId: entry.pending.roomId,
        mediaType: entry.pending.mediaType,
        tmdbId: entry.pending.tmdbId,
        title: entry.title,
        positionSeconds: entry.pending.positionSeconds,
        imagePath,
        participantNicknames: entry.participantNicknames,
        participantUserIds: entry.pending.participantUserIds,
      });
      await updateLocalMemory(entry.localId, { cloudId, imagePath, pending: null });
    } catch {
      // Transient (offline, token, RLS hiccup) — the next sweep retries.
    }
  }
}

// ── Opportunistic server-side cleanup ───────────────────────────────────────
// cleanup_expired_watch_rooms() (migration 20260710190000) purges long-expired
// room rows and their orphaned Storage objects. Until pg_cron is enabled it is
// nudged from the client, at most once a day per device; errors (migration not
// applied yet, offline) are irrelevant here.

const CLEANUP_STAMP_KEY = "streambox/watch-cleanup-last-run";
const CLEANUP_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function runOpportunisticCleanup(): Promise<void> {
  try {
    const stamp = await AsyncStorage.getItem(CLEANUP_STAMP_KEY);
    if (stamp && Date.now() - Number(stamp) < CLEANUP_MIN_INTERVAL_MS) return;
    await AsyncStorage.setItem(CLEANUP_STAMP_KEY, String(Date.now()));
    await supabase.rpc("cleanup_expired_watch_rooms");
  } catch {
    /* best-effort */
  }
}
