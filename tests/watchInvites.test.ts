import assert from "node:assert/strict";
import test from "node:test";

import {
  type InviteState,
  canRoleAct,
  inviteRemainingMs,
  inviteRemainingSeconds,
  inviteStatusAtTime,
  isTerminalInviteStatus,
  reduceInvite,
} from "../src/utils/watchInvites";

const NOW = 1_750_000_000_000;
const TTL_MS = 2 * 60 * 1000;

function pending(expiresInMs = TTL_MS): InviteState {
  return { status: "pending", expiresAt: NOW + expiresInMs };
}

test("isTerminalInviteStatus: only pending is non-terminal", () => {
  assert.equal(isTerminalInviteStatus("pending"), false);
  for (const s of ["accepted", "declined", "cancelled", "expired"] as const) {
    assert.equal(isTerminalInviteStatus(s), true);
  }
});

test("inviteStatusAtTime: pending past TTL reads as expired", () => {
  const state = pending();
  assert.equal(inviteStatusAtTime(state, NOW), "pending");
  assert.equal(inviteStatusAtTime(state, NOW + TTL_MS - 1), "pending");
  assert.equal(inviteStatusAtTime(state, NOW + TTL_MS), "expired");
  assert.equal(inviteStatusAtTime(state, NOW + TTL_MS + 5000), "expired");
});

test("remaining time counts down and floors at zero", () => {
  const state = pending();
  assert.equal(inviteRemainingMs(state, NOW), TTL_MS);
  assert.equal(inviteRemainingSeconds(state, NOW), 120);
  assert.equal(inviteRemainingMs(state, NOW + TTL_MS + 1000), 0);
  assert.equal(inviteRemainingSeconds(state, NOW + TTL_MS + 1000), 0);
  // A terminal invite has no remaining time.
  assert.equal(inviteRemainingMs({ status: "accepted", expiresAt: NOW + TTL_MS }, NOW), 0);
});

test("recipient accepts / declines a live invite", () => {
  assert.equal(reduceInvite(pending(), { type: "accept", by: "recipient" }, NOW).status, "accepted");
  assert.equal(reduceInvite(pending(), { type: "decline", by: "recipient" }, NOW).status, "declined");
});

test("sender cancels a live invite", () => {
  assert.equal(reduceInvite(pending(), { type: "cancel", by: "sender" }, NOW).status, "cancelled");
});

test("wrong role cannot transition", () => {
  // Sender cannot accept/decline; recipient cannot cancel.
  assert.equal(reduceInvite(pending(), { type: "accept", by: "sender" }, NOW).status, "pending");
  assert.equal(reduceInvite(pending(), { type: "decline", by: "sender" }, NOW).status, "pending");
  assert.equal(reduceInvite(pending(), { type: "cancel", by: "recipient" }, NOW).status, "pending");
});

test("expiry wins over a late accept (race: cancel/expiry lands first)", () => {
  const state = pending();
  const late = reduceInvite(state, { type: "accept", by: "recipient" }, NOW + TTL_MS + 1);
  assert.equal(late.status, "expired");
});

test("cancel after already accepted is a no-op (terminal locked)", () => {
  const accepted = reduceInvite(pending(), { type: "accept", by: "recipient" }, NOW);
  const afterCancel = reduceInvite(accepted, { type: "cancel", by: "sender" }, NOW);
  assert.equal(afterCancel.status, "accepted");
});

test("explicit expire action", () => {
  assert.equal(reduceInvite(pending(), { type: "expire" }, NOW).status, "expired");
});

test("sync trusts the server's terminal status", () => {
  assert.equal(reduceInvite(pending(), { type: "sync", status: "declined" }, NOW).status, "declined");
  assert.equal(reduceInvite(pending(), { type: "sync", status: "accepted" }, NOW).status, "accepted");
});

test("sync 'pending' does not un-expire a locally lapsed TTL", () => {
  const state = pending();
  const synced = reduceInvite(state, { type: "sync", status: "pending" }, NOW + TTL_MS + 1);
  assert.equal(synced.status, "expired");
});

test("canRoleAct only while effectively pending", () => {
  const state = pending();
  assert.ok(canRoleAct(state, "recipient", NOW));
  assert.ok(canRoleAct(state, "sender", NOW));
  assert.ok(!canRoleAct(state, "recipient", NOW + TTL_MS));
  assert.ok(!canRoleAct({ status: "accepted", expiresAt: NOW + TTL_MS }, "recipient", NOW));
});

test("reducer never mutates the input state", () => {
  const state = pending();
  const snapshot = { ...state };
  reduceInvite(state, { type: "accept", by: "recipient" }, NOW);
  assert.deepEqual(state, snapshot);
});
