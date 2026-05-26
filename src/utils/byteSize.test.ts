import { utf8ByteSize } from './byteSize';

describe('utf8ByteSize', () => {
  it('counts ASCII as one byte per character', () => {
    expect(utf8ByteSize('')).toBe(0);
    expect(utf8ByteSize('hello')).toBe(5);
  });

  it('counts 2-byte code points (Latin-1 supplement, e.g. accented chars)', () => {
    // 'é' is U+00E9 → 2 UTF-8 bytes, 1 UTF-16 unit.
    expect(utf8ByteSize('é')).toBe(2);
    expect('é'.length).toBe(1);
  });

  it('counts 3-byte code points (CJK)', () => {
    // '中' is U+4E2D → 3 UTF-8 bytes, 1 UTF-16 unit.
    expect(utf8ByteSize('中')).toBe(3);
    expect('中'.length).toBe(1);
  });

  it('counts 4-byte code points (emoji / surrogate pairs)', () => {
    // '🐷' is U+1F437 → 4 UTF-8 bytes, 2 UTF-16 units (surrogate pair).
    expect(utf8ByteSize('🐷')).toBe(4);
    expect('🐷'.length).toBe(2);
  });

  it('is larger than .length for non-ASCII — the bug the guard depends on', () => {
    const emojiHeavy = '🐷🐷🐷 hello 中文';
    expect(utf8ByteSize(emojiHeavy)).toBeGreaterThan(emojiHeavy.length);
  });
});
