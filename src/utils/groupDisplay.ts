import { sanitizeDisplayText } from './sanitizeDisplayText';

/** Sanitize both restored and relay-derived group labels at the display boundary. */
export function groupDisplay<T extends { name: string }>(group: T): T {
  const name = sanitizeDisplayText(group.name, { maxLen: 64 });
  return name === group.name ? group : { ...group, name };
}
