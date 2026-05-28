/**
 * Exact UTF-8 byte length of a string — the unit Android's SQLite
 * `CursorWindow` row limit (and AsyncStorage's on-disk JSON) actually
 * measures.
 *
 * `String.prototype.length` counts UTF-16 code units, which undercounts
 * non-ASCII text: a CJK character is 1 code unit but 3 bytes, an emoji
 * is 2 code units (a surrogate pair) but 4 bytes. A size guard based on
 * `.length` can therefore pass while the persisted row is over the
 * limit and becomes unreadable — so cache byte-caps must use this.
 *
 * Allocation-free: walks the string once rather than encoding it into a
 * Uint8Array (which would allocate a buffer the size of the payload).
 */
export function utf8ByteSize(str: string): number {
  let bytes = 0;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      // High surrogate followed by a low surrogate → a 4-byte code
      // point. Consume both. A lone surrogate (malformed, never
      // produced by JSON.stringify of valid data) falls through to 3.
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
