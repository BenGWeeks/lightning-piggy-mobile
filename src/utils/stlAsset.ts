// Lightweight integrity checks for the bundled Piggy Bag Charm STL.
//
// Background: the "Save STL" button in HuntCreateScreen ships the 3D-print
// file bundled inside the app (assets/3d/piggy-bag-charm.stl) and copies it
// out on tap. At one point the committed asset was not an STL at all but a
// saved GitHub "blob view" HTML page (a few hundred KB of markup with a .stl
// extension), because someone saved the rendered file page instead of using
// "Download raw file". The button worked, but every save produced a file no
// slicer could open.
//
// These helpers let us fail loudly (in a dev-time check and in a unit test)
// instead of silently shipping a renamed web page again.

// An ASCII STL begins with the token "solid". A binary STL has an 80-byte
// header (conventionally NOT starting with "solid") followed by a little-endian
// uint32 triangle count, then 50 bytes per triangle. We accept either form and,
// for binary, sanity-check that the declared triangle count matches the byte
// length. We also explicitly reject the HTML-masquerading-as-STL case.

const HTML_SNIFF = /^\s*(<!doctype html|<html\b|<!--)/i;

export type StlValidationResult =
  | { ok: true; kind: 'ascii' | 'binary'; triangles?: number }
  | { ok: false; reason: string };

/**
 * Validate the first bytes / whole buffer of a candidate STL.
 *
 * @param bytes  The file contents. For the binary-length cross-check to run,
 *               pass the full buffer; a short prefix still catches the common
 *               "it's actually HTML" and "it's actually ASCII" cases.
 */
export function validateStl(bytes: Uint8Array): StlValidationResult {
  if (bytes.length < 15) {
    return { ok: false, reason: `too small to be an STL (${bytes.length} bytes)` };
  }

  // Decode a small prefix as latin1/ascii for sniffing. We avoid TextDecoder
  // dependence for RN/Hermes portability and just map bytes to chars.
  const prefixLen = Math.min(bytes.length, 512);
  let prefix = '';
  for (let i = 0; i < prefixLen; i++) prefix += String.fromCharCode(bytes[i]);

  if (HTML_SNIFF.test(prefix)) {
    return {
      ok: false,
      reason:
        'looks like an HTML document, not an STL (was the GitHub blob page ' +
        'saved instead of the raw file?)',
    };
  }

  // ASCII STL: starts with "solid" and, being text, contains no NUL bytes.
  const startsWithSolid = /^\s*solid\b/i.test(prefix);
  const hasNul = bytes.subarray(0, prefixLen).includes(0);
  if (startsWithSolid && !hasNul) {
    return { ok: true, kind: 'ascii' };
  }

  // Binary STL: 80-byte header + uint32 count + 50 bytes/triangle.
  if (bytes.length >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triangles = view.getUint32(80, true);
    const expected = 84 + triangles * 50;
    if (triangles > 0 && expected === bytes.length) {
      return { ok: true, kind: 'binary', triangles };
    }
    // If the count doesn't line up but the file clearly isn't text/HTML, we
    // still surface a helpful reason rather than a bare false.
    return {
      ok: false,
      reason:
        `binary STL triangle count (${triangles}) implies ${expected} bytes ` +
        `but file is ${bytes.length} bytes`,
    };
  }

  return { ok: false, reason: 'not recognisable as ASCII or binary STL' };
}

/** Convenience boolean form. */
export function isValidStl(bytes: Uint8Array): boolean {
  return validateStl(bytes).ok;
}

// Minimal, dependency-free base64 -> bytes decoder. React Native / Hermes has
// no atob, and we don't want to pull Buffer into the bundle just for this
// prefix check. Only enough of the STL is needed for validation, but decoding
// the whole (small) buffer keeps the binary length cross-check meaningful.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const outLen = Math.floor((len * 3) / 4) - pad;
  const out = new Uint8Array(outLen < 0 ? 0 : outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = B64.indexOf(clean[i + 2]);
    const d = B64.indexOf(clean[i + 3]);
    const chunk = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
    if (o < outLen) out[o++] = (chunk >> 16) & 0xff;
    if (o < outLen) out[o++] = (chunk >> 8) & 0xff;
    if (o < outLen) out[o++] = chunk & 0xff;
  }
  return out;
}
