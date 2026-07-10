import AsyncStorage from "@react-native-async-storage/async-storage";

import type { MediaType } from "../api/tmdb";

// A small on-device index of watch-together polaroids, written the instant a
// polaroid is captured — BEFORE the cloud upload. This makes a memory appear in
// Shared Sessions immediately and, crucially, survive leaving the session while
// the upload is still in flight. Entries carrying a `pending` payload double as
// the upload OUTBOX: syncPendingMemories (watchMemorySync.ts) retries them
// until the cloud row is confirmed, so an app kill or network failure at
// capture time can no longer silently cost the partner their copy. The image
// bytes live in the file cache (see watchMemories.ts); this store only holds
// the lightweight metadata.

const STORAGE_KEY = "streambox/watch-memories-local";

// Everything the background sync needs to upload + insert the memory without
// the room session still being alive.
export type PendingMemoryUpload = {
  roomId: string;
  mediaType: MediaType;
  tmdbId: number;
  positionSeconds: number;
  participantUserIds: string[];
};

export type LocalMemory = {
  // Client-generated UUID, and — for entries captured since the outbox — the
  // cloud row id too (same id from birth is what makes retries idempotent).
  localId: string;
  // Set once the cloud row insert is confirmed.
  cloudId: string | null;
  title: string;
  participantNicknames: string[];
  createdAtEpochMs: number;
  // file:// path of the cached polaroid PNG.
  imageLocalUri: string;
  // Cloud Storage object path, set once the image upload succeeds.
  imagePath: string | null;
  // Outbox payload; cleared on success or when retrying is abandoned. Legacy
  // (pre-outbox) entries lack it and simply stay local-only.
  pending?: PendingMemoryUpload | null;
};

export async function listLocalMemories(): Promise<LocalMemory[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalMemory[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(entries: LocalMemory[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export async function addLocalMemory(entry: LocalMemory): Promise<void> {
  const all = await listLocalMemories();
  await writeAll([entry, ...all.filter((m) => m.localId !== entry.localId)]);
}

export async function updateLocalMemory(
  localId: string,
  patch: Partial<Omit<LocalMemory, "localId">>
): Promise<void> {
  const all = await listLocalMemories();
  await writeAll(all.map((m) => (m.localId === localId ? { ...m, ...patch } : m)));
}

export async function removeLocalMemory(localId: string): Promise<void> {
  const all = await listLocalMemories();
  await writeAll(all.filter((m) => m.localId !== localId));
}

// Remove the local index entry matching a cloud id (used when a memory is
// deleted through its cloud row).
export async function removeLocalMemoryByCloudId(cloudId: string): Promise<void> {
  const all = await listLocalMemories();
  const next = all.filter((m) => m.cloudId !== cloudId);
  if (next.length !== all.length) await writeAll(next);
}
