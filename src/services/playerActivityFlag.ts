/**
 * Lightweight global flag for whether the user is currently inside the native
 * playback screen. Read by the prompted OTA flow in LiveOpsHost: we MUST NOT
 * offer `Updates.reloadAsync()` while a movie is playing, because that would
 * yank the user out of the player mid-playback when they return from briefly
 * locking the screen.
 *
 * Module-level state on purpose — this is a one-bit signal and threading it
 * through context would be overkill.
 */
let playerActive = false;

export function setPlayerActive(active: boolean): void {
  playerActive = active;
}

export function isPlayerActive(): boolean {
  return playerActive;
}
