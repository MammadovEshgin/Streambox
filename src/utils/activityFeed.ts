import type { MediaType } from "../api/tmdb";

// ---------------------------------------------------------------------------
// Activity feed grouping — pure logic (no React Native imports, see
// tests/activityFeed.test.ts).
//
// The feed RPC (get_following_activity) returns rows newest-first. A bulk
// Letterboxd import lands as a burst of same-actor + same-type events; rather
// than flooding a follower's feed with 100 identical-looking rows (Letterboxd
// does the same), the client COLLAPSES a maximal run of >= ACTIVITY_GROUP_MIN
// consecutive events by one actor of one type into a single group row
// ("Eshgin watched 12 films"). Shorter runs render as individual rows.
// ---------------------------------------------------------------------------

export type ActivityEventType = "watched" | "liked" | "watchlisted";

export type ActivityItem = {
  activityId: number;
  actorId: string;
  username: string | null;
  displayName: string;
  avatarPath: string | null;
  avatarVersion?: number;
  eventType: ActivityEventType;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  createdAt: string; // ISO 8601
};

export const ACTIVITY_GROUP_MIN = 4;

export type ActivityFeedRow =
  | { kind: "single"; key: string; item: ActivityItem }
  | {
      kind: "group";
      key: string;
      actorId: string;
      username: string | null;
      displayName: string;
      avatarPath: string | null;
      avatarVersion?: number;
      eventType: ActivityEventType;
      items: ActivityItem[];
      count: number;
      latestCreatedAt: string;
    };

/**
 * Collapse consecutive same-actor + same-type runs of >= minGroupSize into one
 * group row. Input MUST be in feed order (newest first); the run head is the
 * newest item, so latestCreatedAt is head.createdAt.
 */
export function groupActivityFeed(
  items: ActivityItem[],
  minGroupSize: number = ACTIVITY_GROUP_MIN
): ActivityFeedRow[] {
  const rows: ActivityFeedRow[] = [];
  let i = 0;
  while (i < items.length) {
    let j = i + 1;
    while (
      j < items.length &&
      items[j].actorId === items[i].actorId &&
      items[j].eventType === items[i].eventType
    ) {
      j += 1;
    }
    const run = items.slice(i, j);
    if (run.length >= minGroupSize) {
      const head = run[0];
      rows.push({
        kind: "group",
        key: `group-${head.actorId}-${head.eventType}-${head.activityId}`,
        actorId: head.actorId,
        username: head.username,
        displayName: head.displayName,
        avatarPath: head.avatarPath,
        avatarVersion: head.avatarVersion,
        eventType: head.eventType,
        items: run,
        count: run.length,
        latestCreatedAt: head.createdAt,
      });
    } else {
      for (const item of run) {
        rows.push({ kind: "single", key: `single-${item.activityId}`, item });
      }
    }
    i = j;
  }
  return rows;
}

/** The cursor to request the next page: the oldest row's (createdAt, id). */
export function activityFeedCursor(
  items: ActivityItem[]
): { before: string; beforeId: number } | null {
  if (items.length === 0) return null;
  const last = items[items.length - 1];
  return { before: last.createdAt, beforeId: last.activityId };
}

/**
 * Append a freshly fetched page to the existing list, de-duplicating by
 * activityId (keyset paging on identical timestamps can re-surface a boundary
 * row). Preserves order; existing rows win.
 */
export function mergeActivityPages(
  existing: ActivityItem[],
  incoming: ActivityItem[]
): ActivityItem[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((item) => item.activityId));
  const merged = existing.slice();
  for (const item of incoming) {
    if (!seen.has(item.activityId)) {
      seen.add(item.activityId);
      merged.push(item);
    }
  }
  return merged;
}
