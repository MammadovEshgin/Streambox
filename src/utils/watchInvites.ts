// ---------------------------------------------------------------------------
// Watch Together invite state machine — pure logic (no React Native imports,
// see tests/watchInvites.test.ts).
//
// Mirrors the server semantics in migration 20260725120000 (send/respond/
// cancel_watch_invite). The DB is authoritative — its atomic status predicate
// (`status='pending' and expires_at > now()`) decides races. This reducer lets
// the client drive the sender's waiting overlay and the recipient's popup
// optimistically and stay consistent with whatever the server later reports.
//
// Lifecycle: pending -> accepted | declined | cancelled | expired (terminal).
// Only the RECIPIENT may accept/decline; only the SENDER may cancel; expiry is
// derived from the clock and always wins over a late accept/decline/cancel.
// ---------------------------------------------------------------------------

export type InviteStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired";

export type InviteRole = "sender" | "recipient";

export type InviteState = {
  status: InviteStatus;
  /** Absolute expiry, epoch ms. */
  expiresAt: number;
};

export type InviteAction =
  | { type: "accept"; by: InviteRole }
  | { type: "decline"; by: InviteRole }
  | { type: "cancel"; by: InviteRole }
  | { type: "expire" }
  /** Server told us the authoritative status (Realtime UPDATE / poll). */
  | { type: "sync"; status: InviteStatus };

export function isTerminalInviteStatus(status: InviteStatus): boolean {
  return status !== "pending";
}

/**
 * Status accounting for the clock: a still-"pending" invite whose TTL has
 * elapsed is effectively "expired". Terminal statuses are returned as-is.
 */
export function inviteStatusAtTime(state: InviteState, nowMs: number): InviteStatus {
  if (state.status === "pending" && nowMs >= state.expiresAt) return "expired";
  return state.status;
}

/** Milliseconds left before expiry while pending; 0 once expired/terminal. */
export function inviteRemainingMs(state: InviteState, nowMs: number): number {
  if (state.status !== "pending") return 0;
  return Math.max(0, state.expiresAt - nowMs);
}

/** Whole seconds left (rounded up) for the countdown display. */
export function inviteRemainingSeconds(state: InviteState, nowMs: number): number {
  return Math.ceil(inviteRemainingMs(state, nowMs) / 1000);
}

/**
 * Fold an action into the invite state. Invalid transitions (wrong role, action
 * on a terminal/expired invite) return the state unchanged except that a lapsed
 * TTL is locked in as "expired" so the UI settles. `sync` from the server is
 * trusted verbatim (it is the source of truth) — but a server "pending" never
 * un-expires a locally lapsed TTL.
 */
export function reduceInvite(
  state: InviteState,
  action: InviteAction,
  nowMs: number
): InviteState {
  if (action.type === "sync") {
    if (action.status === "pending") {
      // Keep the local expiry decision — the server row is still open, we just
      // re-derive expiry from the clock.
      const effective = inviteStatusAtTime(state, nowMs);
      return effective === state.status ? state : { ...state, status: effective };
    }
    return state.status === action.status ? state : { ...state, status: action.status };
  }

  const effective = inviteStatusAtTime(state, nowMs);
  if (isTerminalInviteStatus(effective)) {
    // Lock in a just-crossed expiry; otherwise no-op on a terminal invite.
    return effective === state.status ? state : { ...state, status: effective };
  }

  switch (action.type) {
    case "expire":
      return { ...state, status: "expired" };
    case "accept":
      return action.by === "recipient" ? { ...state, status: "accepted" } : state;
    case "decline":
      return action.by === "recipient" ? { ...state, status: "declined" } : state;
    case "cancel":
      return action.by === "sender" ? { ...state, status: "cancelled" } : state;
    default:
      return state;
  }
}

/** Can this role still act on the invite right now? */
export function canRoleAct(state: InviteState, role: InviteRole, nowMs: number): boolean {
  if (inviteStatusAtTime(state, nowMs) !== "pending") return false;
  return role === "recipient" || role === "sender";
}
