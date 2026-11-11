/**
 * One mutation lock per library document (watch history, each watchlist and
 * liked list, watched episodes), shared by every writer: the hooks, the
 * watched-leaves-watchlist prune, the Letterboxd import and the cloud
 * reconcile. Each writer re-reads the stored document inside the lock and
 * applies its change to THAT, never to a copy it took earlier — writing from a
 * stale copy is how a title marked watched while something else was saving
 * silently disappeared again.
 *
 * Writers also queue their sync operation before releasing the lock, so the
 * reconcile (which reads the pending queue inside the same lock) always sees a
 * local change and its queued operation together.
 *
 * Lock order, to stay deadlock-free: a holder may take the sync queue's lock
 * and the watchlist lock (the prune runs inside the watch-history lock), never
 * the other way round.
 */

const chains = new Map<string, Promise<void>>();

export function withLibraryLock<T>(storageKey: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(storageKey) ?? Promise.resolve();
  const run = previous.then(task, task);
  chains.set(
    storageKey,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}
