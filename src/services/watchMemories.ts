import * as FileSystem from "expo-file-system/legacy";

import { supabase } from "./supabase";
import type { MediaType } from "../api/tmdb";
import {
  WATCH_MEMORY_CACHE_DIRNAME,
  memoryCacheFileName,
  selectStaleCacheFiles,
} from "../utils/watchMemoryCache";

// Watch Together "Movie Memories": polaroid PNGs + the raw camera stills they
// are composed from, stored in the private `watch-memories` bucket under
// {room_id}/…, and a row per polaroid in watch_room_memories so both
// participants keep it on their shelf even after the room expires.

const BUCKET = "watch-memories";

async function runNativeUpload(
  signedUrl: string,
  uri: string,
  contentType: string,
  timeoutMs?: number
): Promise<FileSystem.FileSystemUploadResult> {
  const task = FileSystem.createUploadTask(signedUrl, uri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      "Content-Type": contentType,
      "cache-control": "max-age=3600",
      "x-upsert": "true",
    },
  });

  if (!timeoutMs) {
    const result = await task.uploadAsync();
    if (!result) throw new Error("Storage upload was cancelled");
    return result;
  }

  return await new Promise<FileSystem.FileSystemUploadResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Promise.race used to leave the losing native upload alive. Cancel the
      // task before declining so repeated captures cannot stack orphan work.
      void task.cancelAsync().catch(() => undefined).finally(() => reject(new Error("Storage upload timed out")));
    }, timeoutMs);

    void task.uploadAsync().then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!result) reject(new Error("Storage upload was cancelled"));
        else resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function uploadFile(path: string, uri: string, contentType: string, timeoutMs?: number): Promise<string> {
  // Signed URL creation still runs through supabase-js (and therefore Storage
  // RLS); only the large file body moves to Expo's native upload task. This
  // avoids materialising both a 4/3-size base64 string and an ArrayBuffer on
  // the JS thread while Realtime timers are trying to heartbeat.
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data?.signedUrl) throw error ?? new Error("Could not create signed upload URL");
  const result = await runNativeUpload(data.signedUrl, uri, contentType, timeoutMs);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Storage upload failed with status ${result.status}`);
  }
  return path;
}

export async function uploadCameraStill(roomId: string, uri: string, timeoutMs?: number): Promise<string> {
  const name = `${roomId}/stills/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  return uploadFile(name, uri, "image/jpeg", timeoutMs);
}

// Deterministic path (keyed by the client-generated memory id): a retried
// upload overwrites its own half-finished object instead of orphaning it.
export async function uploadPolaroid(roomId: string, memoryId: string, uri: string): Promise<string> {
  const name = `${roomId}/polaroid-${memoryId}.png`;
  return uploadFile(name, uri, "image/png");
}

export async function getMemoryImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// Partner-still exchange: pull the just-uploaded still down to a local temp
// file. The polaroid must compose from disk — snapshotting while expo-image is
// still streaming a remote signed URL bakes a half-loaded photo into the PNG.
export async function downloadMemoryStill(imagePath: string): Promise<string | null> {
  const url = await getMemoryImageUrl(imagePath);
  if (!url) return null;
  try {
    const dest = `${FileSystem.cacheDirectory}watch-still-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const result = await FileSystem.downloadAsync(url, dest);
    return result.uri ?? dest;
  } catch {
    return null;
  }
}

// ── On-device cache ─────────────────────────────────────────────────────────
// Every polaroid is mirrored to `${documentDirectory}watch-memories/{id}.png`
// so the grid paints instantly + offline, and — importantly — Share hands
// expo-sharing a real local file (sharing a remote https URL is unreliable on
// Android). The author caches its own capture immediately; the partner's device
// downloads on first shelf load, so both keep a local copy.

const CACHE_DIR = `${FileSystem.documentDirectory}${WATCH_MEMORY_CACHE_DIRNAME}/`;

async function ensureCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

function localMemoryPath(memoryId: string): string {
  return `${CACHE_DIR}${memoryCacheFileName(memoryId)}`;
}

export async function getCachedMemoryUri(memoryId: string): Promise<string | null> {
  const path = localMemoryPath(memoryId);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? path : null;
}

// Author path: copy the freshly captured polaroid into the cache under its id.
export async function cacheMemoryFromLocalUri(memoryId: string, uri: string): Promise<string | null> {
  try {
    await ensureCacheDir();
    const dest = localMemoryPath(memoryId);
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    return null;
  }
}

// Partner / cross-device path: pull the polaroid from a signed URL into cache.
export async function cacheMemoryFromUrl(memoryId: string, url: string): Promise<string | null> {
  try {
    await ensureCacheDir();
    const dest = localMemoryPath(memoryId);
    const result = await FileSystem.downloadAsync(url, dest);
    return result.uri ?? dest;
  } catch {
    return null;
  }
}

async function deleteCachedMemory(memoryId: string): Promise<void> {
  await FileSystem.deleteAsync(localMemoryPath(memoryId), { idempotent: true }).catch(() => undefined);
}

// Public: drop a cached polaroid image by id (used to clean up a local-only
// memory that never synced to the cloud, so it has no remove RPC to call).
export async function removeCachedMemoryImage(memoryId: string): Promise<void> {
  await deleteCachedMemory(memoryId);
}

// Drop cached files whose memory is no longer on the shelf (removed/expired).
export async function pruneCachedMemories(activeIds: string[]): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!info.exists) return;
    const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
    const stale = selectStaleCacheFiles(files, activeIds);
    await Promise.all(
      stale.map((file) => FileSystem.deleteAsync(`${CACHE_DIR}${file}`, { idempotent: true }).catch(() => undefined))
    );
  } catch {
    /* best-effort cleanup */
  }
}

export type WatchMemoryInput = {
  // Client-generated UUID (utils/uuid.ts) — passing it makes the insert
  // idempotent: a retry after "insert succeeded but the app died before
  // reconciling" hits the primary-key conflict and is treated as success.
  id?: string;
  roomId: string;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  positionSeconds: number;
  imagePath: string;
  caption?: string | null;
  participantNicknames: string[];
  participantUserIds: string[];
};

// Returns the memory's id so the author can cache the polaroid locally under
// that id (matching how the shelf later reads it back).
export async function saveWatchMemory(input: WatchMemoryInput): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const createdBy = data.user?.id;
  if (!createdBy) throw new Error("Not authenticated.");

  const { data: inserted, error } = await supabase
    .from("watch_room_memories")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      room_id: input.roomId,
      created_by: createdBy,
      media_type: input.mediaType,
      tmdb_id: input.tmdbId,
      title: input.title,
      position_seconds: Math.max(0, Math.round(input.positionSeconds)),
      image_path: input.imagePath,
      caption: input.caption ?? null,
      participant_nicknames: input.participantNicknames,
      participant_user_ids: input.participantUserIds,
    })
    .select("id")
    .single();
  if (error) {
    // 23505 = the row from a previous attempt already exists — that IS success.
    if (input.id && (error as { code?: string }).code === "23505") return input.id;
    throw error;
  }
  return (inserted as { id: string }).id;
}

// Per-user delete: removes the caller from the memory's participants (the shared
// row + cloud image are purged server-side once nobody is left) and drops the
// local cache copy. See migration 20260709120000.
export async function deleteWatchMemory(memoryId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_watch_memory", { p_memory_id: memoryId });
  if (error) throw error;
  await deleteCachedMemory(memoryId);
}

export type WatchMemory = {
  id: string;
  title: string;
  imagePath: string;
  caption: string | null;
  positionSeconds: number;
  participantNicknames: string[];
  createdAtEpochMs: number;
};

export async function listWatchMemories(userId: string): Promise<WatchMemory[]> {
  const { data, error } = await supabase
    .from("watch_room_memories")
    .select("id, title, image_path, caption, position_seconds, participant_nicknames, created_at")
    .contains("participant_user_ids", [userId])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    title: row.title,
    imagePath: row.image_path,
    caption: row.caption ?? null,
    positionSeconds: row.position_seconds ?? 0,
    participantNicknames: row.participant_nicknames ?? [],
    createdAtEpochMs: Date.parse(row.created_at),
  }));
}
