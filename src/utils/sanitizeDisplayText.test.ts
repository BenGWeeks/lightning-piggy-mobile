/**
 * Unit tests for `sanitizeDisplayText` — strips the orphaned U+FFFC
 * object-replacement char (the "tofu" box) from user content before
 * display (#764), and — critically — leaves everything else alone.
 */
import { sanitizeDisplayText } from './sanitizeDisplayText';

describe('sanitizeDisplayText', () => {
  it('strips a trailing U+FFFC tofu box but keeps the message', () => {
    // The exact shape pulled off the relay in #764.
    const input = 'Found it! You don’t need to go in the allotments. Stay out!\uFFFC';
    expect(sanitizeDisplayText(input)).toBe(
      'Found it! You don’t need to go in the allotments. Stay out!',
    );
  });

  it('strips U+FFFC anywhere, not just the tail', () => {
    expect(sanitizeDisplayText('a\uFFFCb\uFFFCc')).toBe('abc');
  });

  it('preserves ZWJ-composed emoji (must NOT decompose the grapheme)', () => {
    // Regression lock (#765 review): U+200D is load-bearing in these.
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'; // 👨\u200D👩\u200D👧
    expect(sanitizeDisplayText(`hi ${family}`)).toBe(`hi ${family}`);
    const flag = '\u{1F3F3}️\u200D\u{1F308}'; // 🏳️\u200D🌈
    expect(sanitizeDisplayText(flag)).toBe(flag);
  });

  it('keeps curly quotes, accents and plain emoji untouched', () => {
    const ok = 'It’s café time \u{1F389}\u{1F436}';
    expect(sanitizeDisplayText(ok)).toBe(ok);
  });

  it('returns clean text unchanged and is idempotent', () => {
    const clean = 'plain ascii text';
    expect(sanitizeDisplayText(clean)).toBe(clean);
    const once = sanitizeDisplayText('x\uFFFCy');
    expect(sanitizeDisplayText(once)).toBe(once);
  });

  it('passes empty / falsy input through without throwing', () => {
    expect(sanitizeDisplayText('')).toBe('');
    // @ts-expect-error — guarding the runtime contract against a null leak.
    expect(sanitizeDisplayText(null)).toBe(null);
  });
});
