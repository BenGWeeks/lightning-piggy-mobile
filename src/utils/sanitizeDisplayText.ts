/**
 * Strips orphaned non-printing placeholder characters from user-authored
 * text before it is displayed (find-logs, DM + group message bubbles).
 *
 * The motivating case is **U+FFFC OBJECT REPLACEMENT CHARACTER**. It is the
 * placeholder Unicode leaves where an *inline embedded object* (an image,
 * sticker, memoji, or other attachment anchored within the text) used to
 * be. When rich text carrying such an inline attachment is flattened to a
 * plain string before publishing — classic iOS `NSTextAttachment` →
 * `String` behaviour, but also some keyboards / dictation paths — the
 * object collapses to U+FFFC. The object itself never makes it into the
 * Nostr event, so only the orphaned placeholder survives, and the renderer
 * draws it as a missing-glyph "tofu" box (□). There is nothing to recover —
 * the emoji/image is genuinely gone — so the correct behaviour is to drop
 * the placeholder rather than render a phantom glyph (see #764).
 *
 * We also drop the common zero-width / format characters, which are
 * likewise invisible-but-glyphless and only ever arrive as copy-paste
 * cruft in this context:
 *   - U+200B ZERO WIDTH SPACE
 *   - U+200C ZERO WIDTH NON-JOINER
 *   - U+200D ZERO WIDTH JOINER (orphaned — a *composed* emoji ZWJ sequence
 *     arrives as a single grapheme, never as a lone joiner; a lone one is
 *     leftover cruft)
 *   - U+FEFF ZERO WIDTH NO-BREAK SPACE / BOM
 *
 * Deliberately NOT touched: ordinary punctuation, curly quotes (U+2019 et
 * al.), and real emoji — those are legitimate content that renders fine.
 * The function is a pure, idempotent string→string transform so it can sit
 * at the data-shaping layer and be unit-tested in isolation.
 */

// Orphaned object-replacement placeholder + zero-width / format chars.
// Written with explicit escapes so the set stays reviewable (the literal
// characters are invisible in source).
const ORPHANED_PLACEHOLDERS = /[\uFFFC\u200B\u200C\u200D\uFEFF]/g;

export function sanitizeDisplayText(text: string): string {
  if (!text) return text;
  // Fast path: skip the allocation when there's nothing to strip (the
  // overwhelmingly common case). `.test` advances `lastIndex` on a global
  // regex, so reset it before the subsequent `.replace`.
  if (!ORPHANED_PLACEHOLDERS.test(text)) return text;
  ORPHANED_PLACEHOLDERS.lastIndex = 0;
  return text.replace(ORPHANED_PLACEHOLDERS, '');
}
