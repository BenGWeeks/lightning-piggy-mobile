/**
 * Collapse a long opaque string (hex hash, bolt11 invoice, npub, etc.) to
 * `abcdef…uvwxyz`. Strings shorter than `head + tail + 1` are returned
 * unchanged so we don't accidentally *lengthen* short values.
 */
export function truncateMiddle(value: string, head = 6, tail = 6): string {
  if (!value) return '';
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * Format a unix timestamp (seconds) as a friendly "20 Apr 2026 · 1:24 AM"
 * string. Today's/yesterday's dates get a relative prefix so recent
 * activity is immediately obvious.
 */
export function formatFriendlyDateTime(unixSeconds: number, now: Date = new Date()): string {
  const d = new Date(unixSeconds * 1000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameYMD = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameYMD(d, now)) return `Today · ${time}`;
  if (sameYMD(d, yesterday)) return `Yesterday · ${time}`;
  const dateStr = d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${dateStr} · ${time}`;
}
