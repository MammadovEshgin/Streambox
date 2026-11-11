/**
 * Crash-safe JSON document store for the user's library (watch history,
 * watchlists, liked lists, watched episodes, the sync queue).
 *
 * Why this exists: on Android, AsyncStorage is one SQLite table capped at 6 MB
 * for the WHOLE app (shared with every runtime cache), and a single value larger
 * than the 2 MB CursorWindow cannot be read back at all ("Row too big to fit
 * into CursorWindow"). A long watch history with twenty billed cast members per
 * title crosses 2 MB at roughly 900 titles. From then on every read of it
 * failed: the profile showed an empty Watched shelf, and every new log threw
 * before it was saved or queued — the "my watched films keep disappearing"
 * reports. Files have neither limit.
 *
 * Each document is one file, written as: `<name>.tmp` → read back and compared
 * → rename the current file to `<name>.bak` → rename tmp over the main file.
 * Renames are atomic, so a crash at any point leaves at least one complete copy,
 * and reads fall back main → tmp → bak, skipping anything that doesn't parse.
 *
 * The first read of a document that has no file yet migrates the legacy
 * AsyncStorage value into a file and then frees the AsyncStorage row.
 *
 * Pure: the file system and the legacy store are injected, so every failure
 * path is unit-testable in Node (tests/durableDocumentStore.test.ts).
 */

export type DurableFileBackend = {
  /** File contents, or null when the file does not exist. May throw on I/O errors. */
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
  /** Atomic rename that replaces `to` when it exists. Throws when `from` is missing. */
  move(from: string, to: string): Promise<void>;
  /** Idempotent delete. */
  remove(path: string): Promise<void>;
};

export type LegacyKeyValueBackend = {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
};

export type DurableStoreEvent =
  | { type: "legacy_unreadable"; key: string; error: unknown }
  | { type: "legacy_migrated"; key: string; bytes: number }
  | { type: "recovered_from_copy"; key: string; copy: "tmp" | "bak" }
  | { type: "write_failed"; key: string; error: unknown };

export type DurableDocumentStore = {
  read(key: string): Promise<string | null>;
  write(key: string, contents: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Drop the in-memory copy so the next read goes to disk. Tests only. */
  forgetCache(): void;
};

export function documentFileName(key: string): string {
  return `${key.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;
}

function isCompleteJson(raw: string | null): raw is string {
  if (raw === null || raw.length === 0) return false;
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

export function createDurableDocumentStore(options: {
  directory: string;
  files: DurableFileBackend;
  legacy: LegacyKeyValueBackend | null;
  onEvent?: (event: DurableStoreEvent) => void;
}): DurableDocumentStore {
  const { directory, files, legacy } = options;
  const emit = (event: DurableStoreEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // Reporting must never break storage.
    }
  };

  // What is on disk right now, per key (null = no document). Every access goes
  // through this store, so the memory copy can't drift from the file.
  const memory = new Map<string, string | null>();
  // One chain per key: reads that miss memory and writes queue behind each
  // other, so a read never observes a half-finished write sequence.
  const chains = new Map<string, Promise<unknown>>();

  function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    chains.set(
      key,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  }

  const paths = (key: string) => {
    const base = `${directory}${documentFileName(key)}`;
    return { main: base, tmp: `${base}.tmp`, bak: `${base}.bak` };
  };

  async function readCopy(path: string): Promise<string | null> {
    try {
      const raw = await files.read(path);
      return isCompleteJson(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  async function writeFiles(key: string, contents: string): Promise<void> {
    const { main, tmp, bak } = paths(key);
    await files.write(tmp, contents);
    // A full disk or an interrupted write can leave a short file without
    // throwing; never promote a copy we haven't read back intact.
    const echoed = await files.read(tmp);
    if (echoed !== contents) {
      throw new Error(`durable write of ${key} did not verify`);
    }
    try {
      await files.move(main, bak);
    } catch {
      // No main file yet (first write) — nothing to keep.
    }
    await files.move(tmp, main);
  }

  async function loadFromDisk(key: string): Promise<string | null> {
    const { main, tmp, bak } = paths(key);
    const fromMain = await readCopy(main);
    if (fromMain !== null) return fromMain;

    for (const [copy, path] of [["tmp", tmp], ["bak", bak]] as const) {
      const recovered = await readCopy(path);
      if (recovered !== null) {
        emit({ type: "recovered_from_copy", key, copy });
        // Re-promote so the next launch reads the main file directly.
        await writeFiles(key, recovered).catch(() => undefined);
        return recovered;
      }
    }

    if (!legacy) return null;

    let legacyRaw: string | null;
    try {
      legacyRaw = await legacy.getItem(key);
    } catch (error) {
      // Typically the 2 MB CursorWindow: the value exists but can never be read
      // back. The cloud copy is restored by the library reconcile.
      emit({ type: "legacy_unreadable", key, error });
      return null;
    }
    if (!isCompleteJson(legacyRaw)) return null;

    try {
      await writeFiles(key, legacyRaw);
    } catch (error) {
      // Couldn't move it yet; keep serving the legacy value and leave the row
      // in place so nothing is lost. The next launch tries again.
      emit({ type: "write_failed", key, error });
      return legacyRaw;
    }
    emit({ type: "legacy_migrated", key, bytes: legacyRaw.length });
    // Free the row: a large one is exactly what fills the 6 MB database.
    await legacy.removeItem(key).catch(() => undefined);
    return legacyRaw;
  }

  return {
    read(key) {
      if (memory.has(key)) return Promise.resolve(memory.get(key) ?? null);
      return serialize(key, async () => {
        if (memory.has(key)) return memory.get(key) ?? null;
        const raw = await loadFromDisk(key);
        memory.set(key, raw);
        return raw;
      });
    },

    write(key, contents) {
      return serialize(key, async () => {
        try {
          await writeFiles(key, contents);
        } catch (error) {
          emit({ type: "write_failed", key, error });
          throw error;
        }
        memory.set(key, contents);
        // A legacy row left behind by a failed migration must not resurface
        // after this newer write.
        if (legacy) await legacy.removeItem(key).catch(() => undefined);
      });
    },

    remove(key) {
      return serialize(key, async () => {
        const { main, tmp, bak } = paths(key);
        await Promise.all([files.remove(main), files.remove(tmp), files.remove(bak)]);
        if (legacy) await legacy.removeItem(key).catch(() => undefined);
        memory.set(key, null);
      });
    },

    forgetCache() {
      memory.clear();
    },
  };
}
