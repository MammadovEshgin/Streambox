// Pure queue-reconciliation logic for the Supabase sync flush. Extracted so
// the lost-op regression is unit-testable: the flush used to write back the
// queue snapshot it took BEFORE executing (multi-second uploads included), so
// any operation enqueued while a flush was running got silently erased — that
// is how a banner upload vanished while the avatar upload was in flight.

/**
 * Remove exactly the executed operations from the LATEST queue state, keeping
 * everything else — including ops enqueued while the flush was running and
 * failed ops awaiting retry. Matching is by serialized content: if an op with
 * the same queue key was replaced mid-flight with different content, the newer
 * op does not match the executed one and survives to be synced next (ops are
 * idempotent upserts, so re-execution is safe; dropping is not).
 */
export function reconcileQueueAfterFlush<T>(latestQueue: T[], executed: T[]): T[] {
  if (executed.length === 0) return latestQueue;
  const executedJson = executed.map((op) => JSON.stringify(op));
  return latestQueue.filter((op) => {
    const json = JSON.stringify(op);
    const index = executedJson.indexOf(json);
    if (index >= 0) {
      executedJson.splice(index, 1);
      return false;
    }
    return true;
  });
}

export const SYNC_RETRY_BASE_MS = 5_000;
export const SYNC_RETRY_MAX_MS = 5 * 60_000;
export const SYNC_MAX_ATTEMPTS = 8;

export type RetryableSyncOperation = { attempts?: number; lastFailedAt?: string };

/** Exponential backoff with a ceiling: 5s, 10s, 20s, ... capped at 5 min. */
export function computeSyncRetryDelayMs(attempts: number): number {
  const safe = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;
  return Math.min(SYNC_RETRY_BASE_MS * 2 ** Math.min(safe, 30), SYNC_RETRY_MAX_MS);
}

/** Return a copy of `op` with one more failed attempt recorded. */
export function markSyncOperationFailed<T extends RetryableSyncOperation>(
  op: T,
  now = new Date()
): T {
  return { ...op, attempts: (op.attempts ?? 0) + 1, lastFailedAt: now.toISOString() };
}

/** Split a queue into ops still worth retrying and ops that have exhausted their attempts. */
export function partitionExhaustedSyncOperations<T extends RetryableSyncOperation>(
  queue: T[],
  maxAttempts = SYNC_MAX_ATTEMPTS
): { retryable: T[]; exhausted: T[] } {
  const retryable: T[] = [];
  const exhausted: T[] = [];
  for (const op of queue) {
    if ((op.attempts ?? 0) >= maxAttempts) exhausted.push(op);
    else retryable.push(op);
  }
  return { retryable, exhausted };
}

/**
 * Stamp a failed attempt onto the matching ops in the LATEST queue. Matching is by
 * serialized identity, the same rule reconcileQueueAfterFlush uses, so an op that was
 * replaced mid-flight with new content is left alone (its attempts start fresh).
 */
export function recordFailedSyncAttempts<T extends RetryableSyncOperation>(
  latestQueue: T[],
  failed: T[],
  now = new Date()
): T[] {
  if (failed.length === 0) return latestQueue;
  const failedJson = failed.map((op) => JSON.stringify(op));
  return latestQueue.map((op) => {
    const json = JSON.stringify(op);
    const index = failedJson.indexOf(json);
    if (index < 0) return op;
    failedJson.splice(index, 1);
    return markSyncOperationFailed(op, now);
  });
}

const TRANSIENT_NETWORK_ERROR_PATTERN =
  /network request failed|failed to fetch|network ?error|load failed|timed? ?out|timeout|aborted|socket|ECONN|ENOTFOUND|EAI_AGAIN/i;

/**
 * True when a sync failure looks like missing connectivity rather than the server
 * rejecting the write. supabase-js reports fetch failures as `{ message: "TypeError:
 * Network request failed" }` (not an Error instance), so both shapes are read.
 * Connectivity failures must not count toward dead-lettering: a device that is
 * offline for a while would otherwise discard the user's queued writes.
 */
export function isTransientNetworkSyncError(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  const message =
    typeof error === "string"
      ? error
      : typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "";
  if (TRANSIENT_NETWORK_ERROR_PATTERN.test(message)) return true;
  return error instanceof TypeError && /fetch|network|request/i.test(message);
}

/**
 * True when the write failed only because the session token was missing or expired
 * (PostgREST PGRST301 / HTTP 401). A re-authenticated session fixes these, so like
 * connectivity failures they back off but never count toward dead-lettering.
 */
export function isExpiredSessionSyncError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { code, status, message } = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  if (code === "PGRST301" || code === "PGRST302" || status === 401) return true;
  return (
    typeof message === "string" &&
    /jwt (expired|malformed)|invalid jwt|token (is )?expired/i.test(message)
  );
}
