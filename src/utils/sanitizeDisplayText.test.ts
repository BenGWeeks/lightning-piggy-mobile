import { sanitizeDisplayText } from './sanitizeDisplayText';

describe('sanitizeDisplayText', () => {
  it('strips object-replacement placeholders', () => {
    expect(sanitizeDisplayText('Stay out!\uFFFC')).toBe('Stay out!');
  });

  it('strips zero-width and format characters used as orphaned placeholders', () => {
    expect(sanitizeDisplayText('\uFEFFhe\u200Bll\u200Co\u200D')).toBe('hello');
  });

  it('leaves normal printable text untouched', () => {
    expect(sanitizeDisplayText('Hello 👋\nSee you soon.')).toBe('Hello 👋\nSee you soon.');
  });
});
