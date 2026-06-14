import AsyncStorage from "@react-native-async-storage/async-storage";

import type { FranchiseEntry } from "../api/franchises";
import { getLocalizedFranchiseMetadata } from "../api/tmdb";
import type { AppLanguage } from "../localization/types";

const FRANCHISE_LOCALIZATION_CACHE_PREFIX = "@streambox/franchise-localization-v1";
const COLLECTION_SUFFIX_REGEX = /\s+collection$/i;

type LocalizedFranchiseCopy = {
  title: string | null;
  tagline: string | null;
};

const collectionBaseOverrides: Record<string, string> = {
  dc: "DC",
  mcu: "MCU",
};

const localizedCopyCache = new Map<string, LocalizedFranchiseCopy | null>();
const localizedCopyRequests = new Map<string, Promise<LocalizedFranchiseCopy | null>>();

function buildCopyKey(tmdbId: number, mediaType: FranchiseEntry["mediaType"], language: AppLanguage) {
  return `${FRANCHISE_LOCALIZATION_CACHE_PREFIX}:${language}:${mediaType}:${tmdbId}`;
}

function normalizeLocalizedCopy(value: unknown): LocalizedFranchiseCopy | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" && record.title.trim().length > 0 ? record.title.trim() : null;
  const tagline = typeof record.tagline === "string" && record.tagline.trim().length > 0 ? record.tagline.trim() : null;

  if (!title && !tagline) {
    return null;
  }

  return { title, tagline };
}

async function readStoredLocalizedCopy(key: string) {
  const rawValue = await AsyncStorage.getItem(key);
  if (rawValue === null) {
    return { found: false, value: null as LocalizedFranchiseCopy | null };
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return {
      found: true,
      value: normalizeLocalizedCopy(parsed),
    };
  } catch {
    return { found: false, value: null as LocalizedFranchiseCopy | null };
  }
}

export function formatFranchiseCollectionTitle(title: string, language: AppLanguage) {
  if (language !== "tr") {
    return title;
  }

  if (!COLLECTION_SUFFIX_REGEX.test(title)) {
    return title;
  }

  const baseTitle = title.replace(COLLECTION_SUFFIX_REGEX, "").trim();
  const normalizedBaseTitle = collectionBaseOverrides[baseTitle.toLowerCase()] ?? baseTitle;
  return `${normalizedBaseTitle} Koleksiyonu`;
}

export function getCachedLocalizedFranchiseCopy(entry: FranchiseEntry, language: AppLanguage) {
  if (language !== "tr" || !entry.tmdbId) {
    return null;
  }

  const key = buildCopyKey(entry.tmdbId, entry.mediaType, language);
  return localizedCopyCache.get(key) ?? null;
}

export async function getLocalizedFranchiseCopy(entry: FranchiseEntry, language: AppLanguage) {
  if (language !== "tr" || !entry.tmdbId) {
    return null;
  }

  const key = buildCopyKey(entry.tmdbId, entry.mediaType, language);

  if (localizedCopyCache.has(key)) {
    return localizedCopyCache.get(key) ?? null;
  }

  const existingRequest = localizedCopyRequests.get(key);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    const stored = await readStoredLocalizedCopy(key);
    if (stored.found) {
      localizedCopyCache.set(key, stored.value);
      return stored.value;
    }

    const remoteValue = normalizeLocalizedCopy(
      await getLocalizedFranchiseMetadata(String(entry.tmdbId), entry.mediaType, language)
    );

    localizedCopyCache.set(key, remoteValue);
    await AsyncStorage.setItem(
      key,
      JSON.stringify(remoteValue ?? { title: null, tagline: null })
    ).catch(() => undefined);
    return remoteValue;
  })().finally(() => {
    localizedCopyRequests.delete(key);
  });

  localizedCopyRequests.set(key, request);
  return request;
}
