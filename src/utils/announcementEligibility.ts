/**
 * Should an install that first asked for announcements at `installFirstSeenAtIso`
 * be shown an announcement with this window?
 *
 * News that started before the install existed is history, not news — a fresh
 * install used to be greeted by every announcement ever published (the June
 * 2026 "Letterboxd import" popup months later). The one exception is a
 * deliberately time-boxed campaign (`ends_at` set and still in the future): that
 * is "currently running", so newcomers see it too.
 */
export function isAnnouncementRelevantToInstall(
  row: { starts_at: string | null; ends_at: string | null },
  installFirstSeenAtIso: string,
  nowIso: string
): boolean {
  const startsAt = parseTime(row.starts_at);
  const installedAt = parseTime(installFirstSeenAtIso);
  if (startsAt === null || installedAt === null || startsAt >= installedAt) return true;

  const endsAt = parseTime(row.ends_at);
  const now = parseTime(nowIso);
  return endsAt !== null && now !== null && endsAt > now;
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
