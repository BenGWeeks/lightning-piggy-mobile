/**
 * Tiny ROT13 encoder/decoder. Used for the `hint` tag on NIP-GC kind
 * 37516 listings — the spec recommends ROT13 hint encoding so finders
 * see the hint only after deliberately decoding it (no inline
 * spoilers in scrolling clients).
 *
 * Pure ASCII A-Z / a-z rotation; everything else passes through. The
 * function is symmetric — encode and decode are the same operation.
 */
export const rot13 = (input: string): string =>
  input.replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
