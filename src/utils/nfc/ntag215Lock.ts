// NTAG21x password-lock byte builders. Pure functions; no native deps.
// Sequenced per NXP AN1303 §7.6 + the NTAG215 datasheet (rev 3.2, table 13):
// PWD lives at page 0x85, PACK at 0x86, AUTH0 in CFG_0 byte 3 (page 0x83),
// ACCESS in CFG_1 byte 0 (page 0x84). Locks are reversible — the hider's
// PIN derives back from PWD via `pwdToPin`, and `buildDisableAuthFrame`
// clears AUTH0 once the hider re-authenticates.
//
// Issue #567 — the older `Ndef.makeReadOnly()` path we replace was a one-
// way OTP lock and gave the hider no path back to rewriting the tag.

// 4-byte password + 2-byte PACK acknowledge. Generated client-side and
// persisted in piggyStorageService keyed by the tag UID.
export interface LockSecrets {
  pwd: number[];
  pack: number[];
}

// NTAG21x write command per NXP datasheet §10.5.4: WRITE = 0xA2 followed
// by the 1-byte page address and 4 data bytes. Pages on NTAG215 run
// 0x00..0x86 (135 pages, 4 bytes each).
const CMD_WRITE = 0xa2;
// PWD_AUTH = 0x1B + 4-byte PWD; tag responds with the 2-byte PACK on
// success, NAK on failure. Section §10.7.
const CMD_PWD_AUTH = 0x1b;
// Page addresses for configuration / password storage. See datasheet
// table 5 (NTAG215 memory layout).
const PAGE_CFG_0 = 0x83;
const PAGE_CFG_1 = 0x84;
const PAGE_PWD = 0x85;
const PAGE_PACK = 0x86;
// AUTH0 byte controls the first page that requires authentication for
// writes. NTAG215 user memory starts at page 0x04, so 0x04 protects all
// user data while leaving the manufacturer header (UID/CC/lock) free.
// Anything ≥ 0x87 (≥ first invalid page) disables protection — we use
// 0xFF for "off" to match NXP example code.
const AUTH0_PROTECT_USER_MEMORY = 0x04;
const AUTH0_DISABLED = 0xff;

// Sanity-check helpers — `transceive` accepts arbitrary number[] so a
// caller bug (5-byte PWD, signed values) would happily be sent to the
// chip and corrupt it permanently. Bounds-check at the source instead.
const assertByteArray = (label: string, bytes: number[], len: number): void => {
  if (bytes.length !== len) throw new Error(`${label} must be ${len} bytes, got ${bytes.length}`);
  for (const b of bytes) {
    if (!Number.isInteger(b) || b < 0 || b > 0xff)
      throw new Error(`${label} contains non-byte: ${b}`);
  }
};

// WRITE PWD frame: A2 85 pwd[0..3]. Bytes 4-7 are the password the chip
// will compare against on PWD_AUTH.
export const buildPwdWriteFrame = (pwd: number[]): number[] => {
  assertByteArray('pwd', pwd, 4);
  return [CMD_WRITE, PAGE_PWD, ...pwd];
};

// WRITE PACK frame: A2 86 pack[0..1] 00 00. Bytes 6-7 of page 0x86 are
// RFUI (must be 0).
export const buildPackWriteFrame = (pack: number[]): number[] => {
  assertByteArray('pack', pack, 2);
  return [CMD_WRITE, PAGE_PACK, pack[0], pack[1], 0x00, 0x00];
};

// WRITE CFG_0 to turn protection on. Page 0x83 = [MIRROR, RFUI,
// MIRROR_PAGE, AUTH0]. Setting MIRROR=0 + AUTH0=0x04 leaves UID/CC/lock
// pages free and password-gates everything from user-memory page 4 up,
// including PWD/PACK/CFG so a finder can't read them back.
export const buildEnableAuthFrame = (): number[] => [
  CMD_WRITE,
  PAGE_CFG_0,
  0x00,
  0x00,
  0x00,
  AUTH0_PROTECT_USER_MEMORY,
];

// WRITE CFG_1: [ACCESS, RFUI, RFUI, RFUI]. ACCESS=0x00 = write-protect
// only (reads stay open so finders can still NDEF-read), CFGLCK=0 so
// the hider can disable protection later, AUTHLIM=0 = no brute-force
// counter. We deliberately keep PROT=0 — finders MUST be able to read
// the LNURL on tap.
export const buildSetAccessFrame = (): number[] => [CMD_WRITE, PAGE_CFG_1, 0x00, 0x00, 0x00, 0x00];

// WRITE CFG_0 to turn protection OFF — sets AUTH0 to a page index above
// the chip's last real page so the password check never triggers. Used
// by `unlockHuntTag` after a successful PWD_AUTH.
export const buildDisableAuthFrame = (): number[] => [
  CMD_WRITE,
  PAGE_CFG_0,
  0x00,
  0x00,
  0x00,
  AUTH0_DISABLED,
];

// PWD_AUTH frame the unlock flow sends to prove possession of the PIN
// before flipping AUTH0. Tag responds with PACK (2 bytes) on success.
export const buildPwdAuthFrame = (pwd: number[]): number[] => {
  assertByteArray('pwd', pwd, 4);
  return [CMD_PWD_AUTH, ...pwd];
};

// 6 bytes of cryptographic randomness split 4 + 2. `crypto.getRandomValues`
// is polyfilled in src/polyfills.ts (loads before any module that uses
// it, including this one — see Order matters comment there).
export const generateLockSecrets = (): LockSecrets => {
  const raw = new Uint8Array(6);
  crypto.getRandomValues(raw);
  return {
    pwd: [raw[0], raw[1], raw[2], raw[3]],
    pack: [raw[4], raw[5]],
  };
};

// Surface format for the My-Piglets PIN row — 8 hex chars, uppercase.
// Unambiguous (no I/O/l/1 ambiguity) and easy to read off a screen.
export const pwdToPin = (pwd: number[]): string => {
  assertByteArray('pwd', pwd, 4);
  return pwd.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
};

// Parse a hider-entered PIN back into the 4 PWD bytes. Tolerant of
// whitespace, lowercase, and `0x` prefixes (paste-from-clipboard often
// drags one of those in). Throws on anything that isn't 8 hex chars
// after normalisation.
export const pinToPwd = (pin: string): number[] => {
  const cleaned = pin.replace(/\s+/g, '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{8}$/.test(cleaned)) {
    throw new Error('PIN must be 8 hex characters');
  }
  return [0, 2, 4, 6].map((i) => parseInt(cleaned.slice(i, i + 2), 16));
};

export const packToHex = (pack: number[]): string => {
  assertByteArray('pack', pack, 2);
  return pack.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
};

// Wrap an encoded NDEF message in the TLV envelope NTAG21x readers
// expect (type=0x03, length, value, terminator=0xFE) and pad to a
// 4-byte page boundary. Two length-encodings per the Type-2 Tag spec:
// short form (1 byte) for N < 255, long form (0xFF + 2-byte BE) above.
// Used when writing the NDEF message via raw MifareUltralight page
// writes — the standard `writeNdefMessage` path emits the TLV for us
// but locks the tag exclusively under the Ndef tech (no PWD/PACK
// access in the same session).
export const buildNdefTlvBytes = (ndefBytes: number[]): number[] => {
  const len = ndefBytes.length;
  if (len < 0 || len > 0xfffe) throw new Error(`NDEF length out of range: ${len}`);
  const tlv =
    len < 0xff
      ? [0x03, len, ...ndefBytes, 0xfe]
      : [0x03, 0xff, (len >> 8) & 0xff, len & 0xff, ...ndefBytes, 0xfe];
  while (tlv.length % 4 !== 0) tlv.push(0x00);
  return tlv;
};

// Split a page-aligned byte stream into 4-byte page arrays, the unit
// NTAG21x writes accept. Caller writes each chunk via
// `mifareUltralightWritePage(offset + i, chunk)`.
export const splitIntoPages = (bytes: number[]): number[][] => {
  if (bytes.length % 4 !== 0) throw new Error('byte stream must be page-aligned');
  const out: number[][] = [];
  for (let i = 0; i < bytes.length; i += 4) out.push(bytes.slice(i, i + 4));
  return out;
};

// NTAG215 first user-data page. The pages below it (0x00-0x03) carry
// UID, internal lock bytes, and the Capability Container — never
// overwrite. NTAG213 and NTAG216 also start user memory at page 4.
export const NTAG21X_USER_PAGE_START = 0x04;

export const hexToBytes = (hex: string, len: number): number[] => {
  if (hex.length !== len * 2 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`expected ${len * 2} hex chars`);
  }
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
};
