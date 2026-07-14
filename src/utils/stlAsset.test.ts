import { validateStl, isValidStl, base64ToBytes } from './stlAsset';

// Node's Buffer is available in the Jest environment and gives us a reference
// base64 encoding to round-trip against our RN-safe decoder.
function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function ascii(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

/** Build a minimal-but-valid binary STL with `n` (all-zero) triangles. */
function binaryStl(n: number): Uint8Array {
  const buf = new Uint8Array(84 + n * 50);
  const view = new DataView(buf.buffer);
  // 80-byte header left as zeros (deliberately not "solid").
  view.setUint32(80, n, true);
  return buf;
}

describe('validateStl', () => {
  it('accepts an ASCII STL', () => {
    const res = validateStl(ascii('solid piggy\nfacet normal 0 0 0\nendsolid piggy\n'));
    expect(res).toEqual({ ok: true, kind: 'ascii' });
  });

  it('accepts a well-formed binary STL and reports triangle count', () => {
    const res = validateStl(binaryStl(12));
    expect(res).toEqual({ ok: true, kind: 'binary', triangles: 12 });
  });

  it('rejects a binary STL whose triangle count does not match its length', () => {
    const buf = binaryStl(12);
    const view = new DataView(buf.buffer);
    view.setUint32(80, 999, true); // lie about the count
    const res = validateStl(buf);
    expect(res.ok).toBe(false);
  });

  // The regression this whole change exists for: a saved GitHub blob-view
  // page committed as assets/3d/piggy-bag-charm.stl.
  it('rejects an HTML document masquerading as an STL', () => {
    const html = ascii(
      '\n\n<!DOCTYPE html>\n<html lang="en" data-color-mode="dark">\n<head>\n' +
        '<title>Lightning Piggy Bag Charm.stl at main</title>\n</head>\n',
    );
    const res = validateStl(html);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/html/i);
    expect(isValidStl(html)).toBe(false);
  });

  it('rejects an <html>-first document with no doctype', () => {
    expect(isValidStl(ascii('<html><body>nope</body></html>'))).toBe(false);
  });

  it('rejects an empty or tiny buffer', () => {
    expect(isValidStl(new Uint8Array(0))).toBe(false);
    expect(isValidStl(ascii('solid'))).toBe(false);
  });
});

describe('base64ToBytes', () => {
  it('round-trips a binary STL so validation still passes after decode', () => {
    const original = binaryStl(7);
    const decoded = base64ToBytes(toB64(original));
    expect(Array.from(decoded)).toEqual(Array.from(original));
    expect(validateStl(decoded)).toEqual({ ok: true, kind: 'binary', triangles: 7 });
  });

  it('handles payloads at each padding length', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const src = new Uint8Array(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff));
      expect(Array.from(base64ToBytes(toB64(src)))).toEqual(Array.from(src));
    }
  });

  it('tolerates whitespace/newlines in the base64 stream', () => {
    const src = ascii('solid x\nendsolid x\n');
    const wrapped = toB64(src).replace(/(.{4})/g, '$1\n');
    expect(Array.from(base64ToBytes(wrapped))).toEqual(Array.from(src));
  });
});
