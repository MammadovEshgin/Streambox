import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import {
  createDurableDocumentStore,
  type DurableDocumentStore,
  type DurableFileBackend,
} from "../utils/durableDocumentStore";
import { trackEvent } from "./telemetryService";
import { DURABLE_LIBRARY_STORAGE_KEYS } from "./userDataStorage";

/**
 * Storage for the user's library. Keys in DURABLE_LIBRARY_STORAGE_KEYS live in
 * crash-safe files (see utils/durableDocumentStore for why AsyncStorage can't
 * hold them on Android); every other key passes straight through to
 * AsyncStorage. The API mirrors the AsyncStorage calls the library code used,
 * so callers only swap the import.
 */

const LIBRARY_DIRECTORY = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}user-library/`
  : null;

let directoryReady: Promise<void> | null = null;

function ensureDirectory(): Promise<void> {
  if (!LIBRARY_DIRECTORY) return Promise.resolve();
  if (!directoryReady) {
    directoryReady = FileSystem.makeDirectoryAsync(LIBRARY_DIRECTORY, { intermediates: true })
      .catch(async (error) => {
        // "Already exists" is fine; anything else is retried on the next call.
        const info = await FileSystem.getInfoAsync(LIBRARY_DIRECTORY).catch(() => null);
        if (!info?.exists) {
          directoryReady = null;
          throw error;
        }
      });
  }
  return directoryReady;
}

const fileBackend: DurableFileBackend = {
  async read(path) {
    await ensureDirectory();
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return FileSystem.readAsStringAsync(path);
  },
  async write(path, contents) {
    await ensureDirectory();
    await FileSystem.writeAsStringAsync(path, contents);
  },
  async move(from, to) {
    await FileSystem.moveAsync({ from, to });
  },
  async remove(path) {
    await FileSystem.deleteAsync(path, { idempotent: true });
  },
};

const reportedEvents = new Set<string>();

const durableStore: DurableDocumentStore | null = LIBRARY_DIRECTORY
  ? createDurableDocumentStore({
      directory: LIBRARY_DIRECTORY,
      files: fileBackend,
      legacy: AsyncStorage,
      onEvent: (event) => {
        // Once per key and kind per session: enough to see it, not a flood.
        const tag = `${event.type}:${event.key}`;
        if (reportedEvents.has(tag)) return;
        reportedEvents.add(tag);
        const error =
          "error" in event
            ? event.error instanceof Error
              ? event.error.message
              : String(event.error)
            : undefined;
        trackEvent(
          "library_storage",
          "app",
          {
            outcome: event.type,
            key: event.key,
            ...(error ? { error: error.slice(0, 300) } : {}),
            ...(event.type === "legacy_migrated" ? { bytes: event.bytes } : {}),
            ...(event.type === "recovered_from_copy" ? { copy: event.copy } : {}),
          },
          event.type === "legacy_migrated" ? "info" : "warning"
        );
      },
    })
  : null;

const DURABLE_KEYS = new Set<string>(DURABLE_LIBRARY_STORAGE_KEYS);

function isDurableKey(key: string) {
  return durableStore !== null && DURABLE_KEYS.has(key);
}

export const libraryStorage = {
  getItem(key: string): Promise<string | null> {
    return isDurableKey(key) ? durableStore!.read(key) : AsyncStorage.getItem(key);
  },

  setItem(key: string, value: string): Promise<void> {
    return isDurableKey(key) ? durableStore!.write(key, value) : AsyncStorage.setItem(key, value);
  },

  removeItem(key: string): Promise<void> {
    return isDurableKey(key) ? durableStore!.remove(key) : AsyncStorage.removeItem(key);
  },

  async multiGet(keys: readonly string[]): Promise<Array<[string, string | null]>> {
    const durable = keys.filter(isDurableKey);
    const plain = keys.filter((key) => !isDurableKey(key));
    const [durableValues, plainPairs] = await Promise.all([
      Promise.all(durable.map((key) => durableStore!.read(key))),
      plain.length > 0 ? AsyncStorage.multiGet(plain) : Promise.resolve([] as readonly [string, string | null][]),
    ]);
    const byKey = new Map<string, string | null>(plainPairs.map(([key, value]) => [key, value]));
    durable.forEach((key, index) => byKey.set(key, durableValues[index] ?? null));
    return keys.map((key) => [key, byKey.get(key) ?? null]);
  },

  async multiSet(pairs: ReadonlyArray<readonly [string, string]>): Promise<void> {
    const durable = pairs.filter(([key]) => isDurableKey(key));
    const plain = pairs.filter(([key]) => !isDurableKey(key)).map(([key, value]) => [key, value] as [string, string]);
    // Durable documents first: they are the user's data, the rest is settings.
    for (const [key, value] of durable) {
      await durableStore!.write(key, value);
    }
    if (plain.length > 0) await AsyncStorage.multiSet(plain);
  },

  async multiRemove(keys: readonly string[]): Promise<void> {
    const durable = keys.filter(isDurableKey);
    const plain = keys.filter((key) => !isDurableKey(key));
    await Promise.all(durable.map((key) => durableStore!.remove(key)));
    if (plain.length > 0) await AsyncStorage.multiRemove(plain);
  },
};
