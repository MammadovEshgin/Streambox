import { Platform } from "react-native";

import type { AppLanguage } from "../localization/types";
import { supabase } from "./supabase";
import {
  hasSeenAnnouncementLocally,
  markAnnouncementSeenLocally,
  markThrottledCheck,
  shouldRunThrottledCheck,
} from "./liveOpsStorage";
import { resolvePublicAssetUrl } from "./publicAssetService";

const LAST_ANNOUNCEMENT_CHECK_KEY = "@streambox/live-ops/last-announcement-check-v1";
export const ANNOUNCEMENT_CHECK_INTERVAL_MS = 30 * 60 * 1000;

type AnnouncementRow = {
  id: string;
  slug: string;
  priority: number;
  is_active: boolean;
  requires_auth: boolean;
  display_version: number;
  title_en: string;
  title_tr: string | null;
  body_en: string;
  body_tr: string | null;
  eyebrow_en: string | null;
  eyebrow_tr: string | null;
  cta_label_en: string | null;
  cta_label_tr: string | null;
  cta_url: string | null;
  image_url: string | null;
  accent_hex: string | null;
  starts_at: string;
  ends_at: string | null;
  min_app_version: string | null;
  max_app_version: string | null;
  platforms: string[] | null;
  updated_at: string;
};

type AnnouncementViewRow = {
  announcement_id: string;
  display_version: number;
};

export type LiveAnnouncement = {
  id: string;
  slug: string;
  seenKey: string;
  title: string;
  body: string;
  eyebrow: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  imageUrl: string | null;
  accentHex: string | null;
  priority: number;
};

function getLocalizedValue(language: AppLanguage, englishValue: string | null, turkishValue: string | null) {
  if (language === "tr") {
    return turkishValue?.trim() || englishValue?.trim() || null;
  }

  return englishValue?.trim() || turkishValue?.trim() || null;
}

function normalizeVersion(version: string | null | undefined) {
  if (!version) {
    return [];
  }

  return version
    .trim()
    .split(/[.+-]/)
    .flatMap((chunk) => chunk.split("."))
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part) && part >= 0);
}

function compareVersions(leftVersion: string, rightVersion: string) {
  const left = normalizeVersion(leftVersion);
  const right = normalizeVersion(rightVersion);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;

    if (leftPart > rightPart) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

function supportsAppVersion(row: AnnouncementRow, appVersion: string) {
  if (row.min_app_version && compareVersions(appVersion, row.min_app_version) < 0) {
    return false;
  }

  if (row.max_app_version && compareVersions(appVersion, row.max_app_version) > 0) {
    return false;
  }

  return true;
}

function isActiveNow(row: AnnouncementRow, nowIso: string) {
  if (!row.is_active) {
    return false;
  }

  if (row.starts_at && row.starts_at > nowIso) {
    return false;
  }

  if (row.ends_at && row.ends_at <= nowIso) {
    return false;
  }

  return true;
}

function supportsPlatform(row: AnnouncementRow) {
  if (!row.platforms || row.platforms.length === 0) {
    return true;
  }

  return row.platforms.includes(Platform.OS);
}

function toLiveAnnouncement(row: AnnouncementRow, language: AppLanguage): LiveAnnouncement {
  return {
    id: row.id,
    slug: row.slug,
    seenKey: `${row.id}:${row.display_version}`,
    title: getLocalizedValue(language, row.title_en, row.title_tr) ?? row.title_en,
    body: getLocalizedValue(language, row.body_en, row.body_tr) ?? row.body_en,
    eyebrow: getLocalizedValue(language, row.eyebrow_en, row.eyebrow_tr),
    ctaLabel: getLocalizedValue(language, row.cta_label_en, row.cta_label_tr),
    ctaUrl: row.cta_url,
    imageUrl: resolvePublicAssetUrl(row.image_url),
    accentHex: row.accent_hex,
    priority: row.priority,
  };
}

async function fetchRemoteSeenKeys(userId: string, rows: AnnouncementRow[]) {
  if (rows.length === 0) {
    return new Set<string>();
  }

  const announcementIds = rows.map((row) => row.id);
  const { data, error } = await supabase
    .from("user_announcement_views")
    .select("announcement_id, display_version")
    .eq("user_id", userId)
    .in("announcement_id", announcementIds);

  if (error) {
    console.warn("Announcement seen-state fetch failed:", error.message);
    return new Set<string>();
  }

  return new Set(
    ((data ?? []) as unknown as AnnouncementViewRow[]).map(
      (row) => `${row.announcement_id}:${row.display_version}`
    )
  );
}

export async function fetchNextLiveAnnouncement(input: {
  language: AppLanguage;
  appVersion: string;
  userId: string | null;
}) {
  const shouldCheck = await shouldRunThrottledCheck(LAST_ANNOUNCEMENT_CHECK_KEY, ANNOUNCEMENT_CHECK_INTERVAL_MS);
  if (!shouldCheck) {
    return null;
  }

  await markThrottledCheck(LAST_ANNOUNCEMENT_CHECK_KEY);

  try {
    const { data, error } = await supabase
      .from("app_announcements")
      .select([
        "id",
        "slug",
        "priority",
        "is_active",
        "requires_auth",
        "display_version",
        "title_en",
        "title_tr",
        "body_en",
        "body_tr",
        "eyebrow_en",
        "eyebrow_tr",
        "cta_label_en",
        "cta_label_tr",
        "cta_url",
        "image_url",
        "accent_hex",
        "starts_at",
        "ends_at",
        "min_app_version",
        "max_app_version",
        "platforms",
        "updated_at",
      ].join(", "))
      .order("priority", { ascending: false })
      .order("starts_at", { ascending: false })
      .limit(8);

    if (error) {
      console.warn("Announcement fetch failed:", error.message);
      return null;
    }

    const nowIso = new Date().toISOString();
    const candidates = ((data ?? []) as unknown as AnnouncementRow[]).filter((row) => (
      isActiveNow(row, nowIso)
      && supportsPlatform(row)
      && supportsAppVersion(row, input.appVersion)
      && (!row.requires_auth || Boolean(input.userId))
    ));

    if (candidates.length === 0) {
      return null;
    }

    const remotelySeenKeys = input.userId
      ? await fetchRemoteSeenKeys(input.userId, candidates)
      : new Set<string>();

    for (const row of candidates) {
      const seenKey = `${row.id}:${row.display_version}`;
      const seenLocally = await hasSeenAnnouncementLocally(seenKey);
      if (seenLocally || remotelySeenKeys.has(seenKey)) {
        continue;
      }

      return toLiveAnnouncement(row, input.language);
    }

    return null;
  } catch (error) {
    console.warn("Announcement fetch failed:", error);
    return null;
  }
}

export async function markLiveAnnouncementSeen(input: {
  announcement: LiveAnnouncement;
  userId: string | null;
}) {
  await markAnnouncementSeenLocally(input.announcement.seenKey);

  if (!input.userId) {
    return;
  }

  try {
    const { error } = await supabase
      .from("user_announcement_views")
      .upsert(
        {
          user_id: input.userId,
          announcement_id: input.announcement.id,
          display_version: Number.parseInt(input.announcement.seenKey.split(":")[1] ?? "1", 10) || 1,
          seen_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,announcement_id,display_version",
        }
      );

    if (error) {
      console.warn("Announcement seen-state sync failed:", error.message);
    }
  } catch (error) {
    console.warn("Announcement seen-state sync failed:", error);
  }
}
