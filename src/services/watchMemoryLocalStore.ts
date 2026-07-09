import AsyncStorage from "@react-native-async-storage/async-storage";

// A small on-device index of watch-together polaroids, written the instant a
// polaroid is captured — BEFORE the cloud upload. This makes a memory appear in
// Shared Sessions immediately and, crucially, survive leaving the session while
// the upload is still in flight. Each entry is reconciled with its cloud row id
// once the background upload succeeds. The image bytes live in the file cache
// (see watchMemories.ts); this store only holds the lightweight metadata.

const STORAGE_KEY = "streambox/watch-memories-local";

export type LocalMemory = {
  localId: string;
  // Set once the background cloud upload + row insert succeeds.
  cloudId: string | null;
  title: string;
  participantNicknames: string[];
  createdAtEpochMs: number;
  // file:// path of the cached polaroid PNG.
  imageLocalUri: string;
  // Cloud Storage object path, set alongside cloudId.
  imagePath: string | null;
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
