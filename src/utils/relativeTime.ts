// Compact "time ago" formatter for Nostr event timestamps (seconds since
// epoch). Pure + deterministic (the reference "now" is injectable for tests).
// No React, no I/O (coverage scope: src/utils).

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365 * DAY;

/**
 * Format a UNIX timestamp (seconds) as a short relative label, e.g. "now",
 * "5m", "3h", "2d", "4w", "1y". Future timestamps clamp to "now".
 */
export function relativeTime(createdAtSecs: number, nowSecs: number = Date.now() / 1000): string {
  const diff = Math.floor(nowSecs - createdAtSecs);
  if (!Number.isFinite(diff) || diff < MINUTE) return 'now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d`;
  if (diff < YEAR) return `${Math.floor(diff / WEEK)}w`;
  return `${Math.floor(diff / YEAR)}y`;
}
