import assert from "node:assert/strict";
import test from "node:test";

import {
  computeSyncRetryDelayMs,
  isExpiredSessionSyncError,
  isTransientNetworkSyncError,
  markSyncOperationFailed,
  partitionExhaustedSyncOperations,
  reconcileQueueAfterFlush,
  recordFailedSyncAttempts,
  SYNC_MAX_ATTEMPTS,
  SYNC_RETRY_MAX_MS,
  type RetryableSyncOperation,
} from "../src/utils/syncQueue";

// Ops are plain JSON records in the real queue; shape doesn't matter to the
// reconcile logic, only serialized identity.
type TestOp = Record<string, unknown> & RetryableSyncOperation;
const avatarOp: TestOp = { kind: "asset_upload", assetKind: "avatar", localUri: "file:///streambox/profile-image.jpg", nextVersion: 1 };
const bannerOp: TestOp = { kind: "asset_upload", assetKind: "banner", localUri: "file:///streambox/banner-image.jpg", nextVersion: 1 };
const historyOp: TestOp = { kind: "watch_history_upsert", entry: { id: 1399, mediaType: "tv" } };

test("an op enqueued while the flush was executing survives (the lost-banner regression)", () => {
  // Flush snapshot contained only the avatar op; while its multi-second
  // upload ran, the banner op was enqueued. The old code wrote back the
  // stale snapshot and erased the banner op — it never reached Supabase,
  // with no failure telemetry. Reconciling against the LATEST queue keeps it.
  const latest = [avatarOp, bannerOp];
  const next = reconcileQueueAfterFlush(latest, [avatarOp]);
  assert.deepEqual(next, [bannerOp]);
});

test("executed ops are removed; failed ops stay queued for retry", () => {
  // historyOp failed (not in executed) — it must remain.
  const latest = [avatarOp, historyOp];
  const next = reconcileQueueAfterFlush(latest, [avatarOp]);
  assert.deepEqual(next, [historyOp]);
});

test("an op replaced mid-flight with different content is kept and re-synced", () => {
  // Same queue key, new content (user picked a second avatar while the first
  // was uploading). The executed op no longer matches — the newer op must
  // survive so the latest pick wins.
  const replacedAvatarOp = { ...avatarOp, nextVersion: 2 };
  const latest = [replacedAvatarOp, historyOp];
  const next = reconcileQueueAfterFlush(latest, [avatarOp]);
  assert.deepEqual(next, [replacedAvatarOp, historyOp]);
});

test("ops for other users are untouched", () => {
  const otherUserOp = { kind: "profile_settings", userId: "someone-else" };
  const latest = [otherUserOp, avatarOp];
  const next = reconcileQueueAfterFlush(latest, [avatarOp]);
  assert.deepEqual(next, [otherUserOp]);
});

test("duplicate identical ops are removed once per executed instance", () => {
  const latest = [avatarOp, { ...avatarOp }];
  const next = reconcileQueueAfterFlush(latest, [avatarOp]);
  assert.equal(next.length, 1);
});

test("empty executed list leaves the queue untouched", () => {
  const latest = [avatarOp, bannerOp];
  assert.deepEqual(reconcileQueueAfterFlush(latest, []), latest);
});

test("retry delay backs off exponentially and is capped", () => {
  assert.equal(computeSyncRetryDelayMs(0), 5_000);
  assert.equal(computeSyncRetryDelayMs(1), 10_000);
  assert.equal(computeSyncRetryDelayMs(3), 40_000);
  assert.equal(computeSyncRetryDelayMs(20), SYNC_RETRY_MAX_MS);
  assert.equal(computeSyncRetryDelayMs(-4), 5_000);
  assert.equal(computeSyncRetryDelayMs(Number.NaN), 5_000);
});

test("markSyncOperationFailed counts attempts without mutating the op", () => {
  const now = new Date("2026-09-17T10:00:00.000Z");
  const first = markSyncOperationFailed({ ...historyOp }, now);
  assert.equal(first.attempts, 1);
  assert.equal(first.lastFailedAt, "2026-09-17T10:00:00.000Z");
  const input = { ...historyOp, attempts: 3 };
  assert.equal(markSyncOperationFailed(input, now).attempts, 4);
  assert.equal(input.attempts, 3);
});

test("recordFailedSyncAttempts stamps only the failed op, not unrelated or replaced ops", () => {
  const now = new Date("2026-09-17T10:00:00.000Z");
  const replacedAvatarOp = { ...avatarOp, nextVersion: 2 };
  const latest = [replacedAvatarOp, bannerOp, historyOp];
  const next = recordFailedSyncAttempts(latest, [avatarOp, historyOp], now);
  assert.deepEqual(next, [
    replacedAvatarOp,
    bannerOp,
    { ...historyOp, attempts: 1, lastFailedAt: now.toISOString() },
  ]);
});

test("recordFailedSyncAttempts increments an existing attempt count", () => {
  const stampedOp = { ...historyOp, attempts: 2, lastFailedAt: "2026-09-17T09:00:00.000Z" };
  const [next] = recordFailedSyncAttempts([stampedOp], [stampedOp]);
  assert.equal(next.attempts, 3);
});

test("partitionExhaustedSyncOperations splits at SYNC_MAX_ATTEMPTS", () => {
  const fresh = { ...avatarOp };
  const almost = { ...bannerOp, attempts: SYNC_MAX_ATTEMPTS - 1 };
  const spent = { ...historyOp, attempts: SYNC_MAX_ATTEMPTS };
  const { retryable, exhausted } = partitionExhaustedSyncOperations([fresh, almost, spent]);
  assert.deepEqual(retryable, [fresh, almost]);
  assert.deepEqual(exhausted, [spent]);
});

test("a stamped op is still removed when a later flush executes it as read", () => {
  // The flush passes ops exactly as read from the queue (stamps included), so
  // serialized identity still matches the stored op.
  const [stampedOp] = recordFailedSyncAttempts([historyOp], [historyOp]);
  assert.deepEqual(reconcileQueueAfterFlush([stampedOp, bannerOp], [stampedOp]), [bannerOp]);
});

test("connectivity failures are told apart from server rejections", () => {
  assert.equal(isTransientNetworkSyncError(new TypeError("Network request failed")), true);
  assert.equal(isTransientNetworkSyncError({ message: "TypeError: Network request failed" }), true);
  assert.equal(isTransientNetworkSyncError({ message: "FetchError: request timed out" }), true);
  assert.equal(
    isTransientNetworkSyncError({ code: "42501", message: "permission denied for table" }),
    false
  );
  assert.equal(isTransientNetworkSyncError({ code: "PGRST301", message: "JWT expired" }), false);
  assert.equal(isTransientNetworkSyncError(undefined), false);
});

test("expired-session failures are recognised so they never dead-letter", () => {
  assert.equal(isExpiredSessionSyncError({ code: "PGRST301", message: "JWT expired" }), true);
  assert.equal(isExpiredSessionSyncError({ status: 401, message: "Unauthorized" }), true);
  assert.equal(isExpiredSessionSyncError({ message: "invalid JWT" }), true);
  assert.equal(isExpiredSessionSyncError({ code: "42501", message: "permission denied" }), false);
  assert.equal(isExpiredSessionSyncError("JWT expired"), false);
});
