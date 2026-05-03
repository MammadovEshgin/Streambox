import AsyncStorage from "@react-native-async-storage/async-storage";

const SEEN_ANNOUNCEMENTS_KEY = "@streambox/live-ops/seen-announcements-v1";

type SeenAnnouncementMap = Record<string, number>;

export async function shouldRunThrottledCheck(storageKey: string, intervalMs: number) {
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) {
      return true;
    }

    const lastRunAt = Number(raw);
    if (!Number.isFinite(lastRunAt)) {
      return true;
    }

    return Date.now() - lastRunAt >= intervalMs;
  } catch {
    return true;
  }
}

export async function markThrottledCheck(storageKey: string, at = Date.now()) {
  try {
    await AsyncStorage.setItem(storageKey, String(at));
  } catch {
    // Non-blocking best effort cache.
  }
}

async function readSeenAnnouncements(): Promise<SeenAnnouncementMap> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_ANNOUNCEMENTS_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed as SeenAnnouncementMap;
  } catch {
    return {};
  }
}

export async function hasSeenAnnouncementLocally(seenKey: string) {
  const seenMap = await readSeenAnnouncements();
  return typeof seenMap[seenKey] === "number";
}

export async function markAnnouncementSeenLocally(seenKey: string, seenAt = Date.now()) {
  try {
    const seenMap = await readSeenAnnouncements();
    seenMap[seenKey] = seenAt;
    await AsyncStorage.setItem(SEEN_ANNOUNCEMENTS_KEY, JSON.stringify(seenMap));
  } catch {
    // Non-blocking best effort cache.
  }
}
