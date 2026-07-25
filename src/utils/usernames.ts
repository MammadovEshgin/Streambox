// ---------------------------------------------------------------------------
// Usernames — pure client-side rules (no React Native imports, see
// tests/usernames.test.ts). These MIRROR the server rules in migration
// 20260725120000_social_follow_platform.sql (set_my_username +
// streambox_username_is_reserved). Keep the two in sync: the client validates
// live for instant feedback, but the SECURITY DEFINER RPC is the source of
// truth (uniqueness + cooldown can only be decided server-side).
// ---------------------------------------------------------------------------

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
// Lowercase letters, digits, underscore. The client lowercases input before
// sending, so uppercase in raw input is normalized rather than rejected.
export const USERNAME_ALLOWED_PATTERN = /^[a-z0-9_]+$/;
export const USERNAME_FULL_PATTERN = /^[a-z0-9_]{3,20}$/;
export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;
const USERNAME_CHANGE_COOLDOWN_MS = USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// Mirror of streambox_username_is_reserved's list. Lowercase only.
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "streambox", "admin", "administrator", "support", "system", "root",
  "moderator", "mod", "official", "help", "staff", "owner", "api", "www",
  "me", "you", "null", "undefined", "everyone", "here",
  // Minimal slur/abuse blocklist — mirror of the server's last row.
  "nigger", "nigga", "faggot", "retard", "rapist", "cunt", "whore",
]);

export function normalizeUsername(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

export function isReservedUsername(raw: string): boolean {
  return RESERVED_USERNAMES.has(normalizeUsername(raw));
}

export type UsernameValidationError =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "reserved";

export type UsernameValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; error: UsernameValidationError };

/**
 * Format/reserved validation on the NORMALIZED value. Uniqueness and the
 * 30-day cooldown are NOT checked here — only the RPC can decide those.
 */
export function validateUsername(raw: string): UsernameValidationResult {
  const value = normalizeUsername(raw);
  if (value.length === 0) return { valid: false, error: "empty" };
  if (value.length < USERNAME_MIN_LENGTH) return { valid: false, error: "too_short" };
  if (value.length > USERNAME_MAX_LENGTH) return { valid: false, error: "too_long" };
  if (!USERNAME_ALLOWED_PATTERN.test(value)) return { valid: false, error: "invalid_chars" };
  if (RESERVED_USERNAMES.has(value)) return { valid: false, error: "reserved" };
  return { valid: true, normalized: value };
}

/** Milliseconds until the username can next be changed; 0 when allowed now. */
export function usernameCooldownRemainingMs(
  changedAtIso: string | null | undefined,
  now: number = Date.now()
): number {
  if (!changedAtIso) return 0;
  const changed = Date.parse(changedAtIso);
  if (!Number.isFinite(changed)) return 0;
  return Math.max(0, USERNAME_CHANGE_COOLDOWN_MS - (now - changed));
}

export function canChangeUsername(
  changedAtIso: string | null | undefined,
  now: number = Date.now()
): boolean {
  return usernameCooldownRemainingMs(changedAtIso, now) === 0;
}

/** Whole days (rounded up) left on the cooldown — for "changeable in N days" copy. */
export function usernameCooldownRemainingDays(
  changedAtIso: string | null | undefined,
  now: number = Date.now()
): number {
  const ms = usernameCooldownRemainingMs(changedAtIso, now);
  return ms === 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/** "@handle" for display; empty string stays empty (no bare "@"). */
export function formatHandle(username: string | null | undefined): string {
  const value = (username ?? "").trim();
  return value.length > 0 ? `@${value}` : "";
}
