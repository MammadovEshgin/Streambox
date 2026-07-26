import { fetchUnreadNotificationCount } from "../api/social";

// ---------------------------------------------------------------------------
// App-wide unread-notification badge (WhatsApp style). A tiny observable store
// so the Profile tab icon can show the unread count and keep it until the user
// reads their notifications.
//
// Truth = the server's unread count (fetched via refreshUnreadBadge). We also
// bump optimistically on each realtime notification for instant feedback, and
// clear it when the Notifications screen marks everything read. The periodic
// refresh reconciles any drift from the optimistic path.
// ---------------------------------------------------------------------------

type Listener = (count: number) => void;

let unreadCount = 0;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((listener) => {
    try {
      listener(unreadCount);
    } catch {
      // one bad subscriber must not break the others
    }
  });
}

export function getUnreadBadge(): number {
  return unreadCount;
}

export function subscribeUnreadBadge(listener: Listener): () => void {
  listeners.add(listener);
  listener(unreadCount);
  return () => {
    listeners.delete(listener);
  };
}

export function setUnreadBadge(count: number): void {
  const next = Math.max(0, Math.floor(count) || 0);
  if (next === unreadCount) return;
  unreadCount = next;
  emit();
}

export function incrementUnreadBadge(by = 1): void {
  setUnreadBadge(unreadCount + by);
}

export function clearUnreadBadge(): void {
  setUnreadBadge(0);
}

/** Resync from the server (best-effort; keeps last-known value on failure). */
export async function refreshUnreadBadge(): Promise<void> {
  try {
    const count = await fetchUnreadNotificationCount();
    setUnreadBadge(count);
  } catch {
    // keep last-known
  }
}
