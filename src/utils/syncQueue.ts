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
