/**
 * Unit tests for `sanitizeDisplayText` — strips orphaned non-printing
 * placeholder characters (chiefly U+FFFC, the object-replacement char that
 * renders as a "tofu" box) from user content before display (#764).
 *
 * The contract:
 *   1. The real-world case: a find-log ending in U+FFFC loses the box but
 *      keeps every legible character intact.
 *   2. Zero-width / format chars (U+200B–U+200D, U+FEFF) are stripped too.
 *   3. Legitimate content — curly quotes, accents, real emoji — is KEPT.
 *   4. Pure & idempotent: clean text is returned unchanged (same reference
 *      where possible) and re-sanitising is a no-op.
 *   5. Empty / falsy input is passed through without throwing.
 */
import { sanitizeDisplayText } from './sanitizeDisplayText';

describe('sanitizeDisplayText', () => {
  it('strips a trailing U+FFFC object-replacement box but keeps the message', () => {
    // The exact shape pulled off the relay in #764.
    const input = 'Found it! You don’t need to go in the allotments. Stay out!\uFFFC';
    expect(sanitizeDisplayText(input)).toBe(
      'Found it! You don’t need to go in the allotments. Stay out!',
    );
  });

  it('strips U+FFFC anywhere in the string, not just the tail', () => {
    expect(sanitizeDisplayText('a\uFFFCb\uFFFCc')).toBe('abc');
  });

  it('strips zero-width and BOM/format characters', () => {
    expect(sanitizeDisplayText('hel\u200Blo\u200C\u200Dwo\uFEFFrld')).toBe('helloworld');
  });

  it('keeps curly quotes, accents and real emoji untouched', () => {
    const ok = 'It’s café time \u{1F389}\u{1F436}';
    expect(sanitizeDisplayText(ok)).toBe(ok);
  });

  it('returns clean text unchanged (idempotent / no spurious allocation)', () => {
    const clean = 'plain ascii text';
    expect(sanitizeDisplayText(clean)).toBe(clean);
    // Re-running on already-sanitised text is a no-op.
    const once = sanitizeDisplayText('x\uFFFCy');
    expect(sanitizeDisplayText(once)).toBe(once);
  });

  it('passes empty / falsy input through without throwing', () => {
    expect(sanitizeDisplayText('')).toBe('');
    // @ts-expect-error — guarding the runtime contract against a null leak.
    expect(sanitizeDisplayText(null)).toBe(null);
  });
});
