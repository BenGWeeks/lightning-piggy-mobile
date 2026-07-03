/**
 * Strips the orphaned **U+FFFC OBJECT REPLACEMENT CHARACTER** from
 * user-authored text before it is displayed (find-logs, message bubbles).
 *
 * U+FFFC is the placeholder Unicode leaves where an *inline embedded
 * object* (an image, sticker, memoji) used to be. When rich text carrying
 * an inline attachment is flattened to a plain string before publishing
 * (classic iOS `NSTextAttachment` → `String`), the object collapses to
 * U+FFFC — the object never reaches the relay, so only the placeholder
 * survives and renders as a missing-glyph "tofu" box (□). It is
 * unrecoverable, so the right fix is to drop it (#764).
 *
 * Scope is deliberately ONLY U+FFFC — it's the one orphaned placeholder
 * that renders as a visible box. Zero-width characters are intentionally
 * left alone: U+200D (ZWJ) in particular is load-bearing inside composed
 * emoji (👨‍👩‍👧 is `👨 U+200D 👩 U+200D 👧`) and Indic scripts, so stripping it
 * would shatter legitimate glyphs — the exact phantom-glyph outcome this is
 * meant to prevent.
 */
export function sanitizeDisplayText(text: string): string {
  if (!text || !text.includes('\uFFFC')) return text;
  return text.replace(/\uFFFC/g, '');
}
