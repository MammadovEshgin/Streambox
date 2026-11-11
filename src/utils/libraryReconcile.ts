/**
 * Three-way merge of a local library collection with the cloud's copy.
 *
 * Before this, a device that had bootstrapped once never read the cloud again:
 * whatever went missing locally (an unreadable store, a write that failed, an
 * overwrite by a racing save) stayed missing on that phone for good, although
 * Supabase still held it. Every launch and foreground now reconciles, and the
 * rules below decide each item:
 *
 *   pending delete in the queue        → absent (the user removed it here)
 *   pending upsert in the queue        → the local copy (not uploaded yet)
 *   in both                            → merged (`mergeBoth`)
 *   only in the cloud                  → restored locally
 *   only local, cloud had it last time → deleted on another device: removed
 *   only local, never seen in cloud    → kept, and reported for upload
 *
 * "Cloud had it last time" is the base: the cloud's keys at the previous
 * reconcile. Without a base (first run on a device) nothing is removed — the
 * merge is a plain union, which can only ever add.
 *
 * Removals are also capped: if one pass would delete more than half the local
 * collection (and more than a handful of items) the cloud answer is treated as
 * suspect and nothing is removed. Losing a user's library to a bad response is
 * worse than briefly keeping a title they deleted elsewhere.
 */

export type PendingIntent = "upsert" | "delete";

export type ReconcileResult<T> = {
  /** The merged collection in display order. */
  items: T[];
  changed: boolean;
  /** Keys present only locally and never seen in the cloud: upload them. */
  localOnlyKeys: string[];
  restoredKeys: string[];
  removedKeys: string[];
  /** True when the removal cap held back deletions. */
  removalsSuppressed: boolean;
};

export const RECONCILE_MIN_REMOVALS_TO_SUSPECT = 10;

export function reconcileCollection<T>(input: {
  local: T[];
  remote: T[];
  keyOf: (item: T) => string;
  base: ReadonlySet<string> | null;
  pending: ReadonlyMap<string, PendingIntent>;
  mergeBoth?: (local: T, remote: T) => T;
  /** Where cloud-only items go relative to the kept local ones. */
  restoredPlacement?: "append" | "prepend";
}): ReconcileResult<T> {
  const { local, remote, keyOf, base, pending } = input;
  const mergeBoth = input.mergeBoth ?? ((localItem: T) => localItem);

  const remoteByKey = new Map<string, T>();
  for (const item of remote) {
    const key = keyOf(item);
    if (!remoteByKey.has(key)) remoteByKey.set(key, item);
  }

  const kept: T[] = [];
  const keptKeys = new Set<string>();
  const localOnlyKeys: string[] = [];
  const removalCandidates: { key: string; item: T }[] = [];
  let changed = false;

  for (const item of local) {
    const key = keyOf(item);
    if (keptKeys.has(key)) {
      changed = true; // duplicate collapsed
      continue;
    }
    const intent = pending.get(key);
    if (intent === "delete") {
      changed = true;
      continue;
    }
    const remoteItem = remoteByKey.get(key);
    if (intent === "upsert") {
      kept.push(item);
      keptKeys.add(key);
      continue;
    }
    if (remoteItem !== undefined) {
      const merged = mergeBoth(item, remoteItem);
      if (merged !== item) changed = true;
      kept.push(merged);
      keptKeys.add(key);
      continue;
    }
    if (base?.has(key)) {
      removalCandidates.push({ key, item });
      continue;
    }
    kept.push(item);
    keptKeys.add(key);
    localOnlyKeys.push(key);
  }

  const removalsSuppressed =
    removalCandidates.length >= RECONCILE_MIN_REMOVALS_TO_SUSPECT &&
    removalCandidates.length * 2 > local.length;

  const removedKeys: string[] = [];
  if (removalsSuppressed) {
    for (const { key, item } of removalCandidates) {
      kept.push(item);
      keptKeys.add(key);
    }
  } else {
    for (const { key } of removalCandidates) removedKeys.push(key);
    if (removedKeys.length > 0) changed = true;
  }

  const restored: T[] = [];
  const restoredKeys: string[] = [];
  for (const [key, item] of remoteByKey) {
    if (keptKeys.has(key) || pending.get(key) === "delete") continue;
    restored.push(item);
    restoredKeys.push(key);
    keptKeys.add(key);
  }
  if (restored.length > 0) changed = true;

  const items = input.restoredPlacement === "prepend" ? [...restored, ...kept] : [...kept, ...restored];

  return { items, changed, localOnlyKeys, restoredKeys, removedKeys, removalsSuppressed };
}
