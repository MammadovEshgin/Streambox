import assert from "node:assert/strict";
import test from "node:test";

import { reconcileQueueAfterFlush } from "../src/utils/syncQueue";

// Ops are plain JSON records in the real queue; shape doesn't matter to the
// reconcile logic, only serialized identity.
const avatarOp = { kind: "asset_upload", assetKind: "avatar", localUri: "file:///streambox/profile-image.jpg", nextVersion: 1 };
const bannerOp = { kind: "asset_upload", assetKind: "banner", localUri: "file:///streambox/banner-image.jpg", nextVersion: 1 };
const historyOp = { kind: "watch_history_upsert", entry: { id: 1399, mediaType: "tv" } };

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
