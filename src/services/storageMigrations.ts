import AsyncStorage from "@react-native-async-storage/async-storage";

import { clearPersistedMediaHydrationCache } from "./mediaHydration";
import { clearPersistedRuntimeCaches } from "./runtimeCache";

const STORAGE_SCHEMA_KEY = "@streambox/storage-schema-version";
const CURRENT_STORAGE_SCHEMA_VERSION = "3";

export async function runStorageMigrationsIfNeeded(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_SCHEMA_KEY);
    if (stored === CURRENT_STORAGE_SCHEMA_VERSION) {
      return;
    }

    await clearPersistedRuntimeCaches();
    await clearPersistedMediaHydrationCache();
    await AsyncStorage.setItem(STORAGE_SCHEMA_KEY, CURRENT_STORAGE_SCHEMA_VERSION);
  } catch (error) {
    console.warn("[storageMigrations] failed to run schema migration:", error);
  }
}
