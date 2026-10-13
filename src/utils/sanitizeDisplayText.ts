/** Bound untrusted UI text without altering identifiers or signed content. */
export function sanitizeDisplayText(text: string): string;
export function sanitizeDisplayText(
  text: unknown,
  options: { maxLen: number; allowNewlines?: boolean },
): string;
export function sanitizeDisplayText(
  text: unknown,
  options?: { maxLen: number; allowNewlines?: boolean },
): string {
  // Existing rich-message callers also parse URLs and protocol content. Keep
  // their placeholder-only cleanup; UI labels opt into bounded sanitisation.
  if (!options) return typeof text === 'string' ? text.replace(/\uFFFC/g, '') : (text as string);
  const { maxLen, allowNewlines = false } = options;
  if (typeof text !== 'string') return '';
  const limit = Math.max(0, Math.floor(maxLen));
  if (!limit) return '';
  const clean = text
    .normalize('NFC')
    .replace(
      /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200b-\u200d\u2060\ufeff\ufffc]/g,
      '',
    )
    .replace(allowNewlines ? /[^\S\n]+/g : /\s+/g, ' ')
    .trim();
  if (clean.length <= limit) return clean;
  // Avoid ending on half a surrogate pair.
  let end = limit - 1;
  if (end > 0 && /[\ud800-\udbff]/.test(clean[end - 1])) end--;
  return `${clean.slice(0, end)}…`;
}
