// NTAG21x password-lock byte builders. Pure functions; no native deps.
// Sequenced per NXP AN1303 §7.6 + the NTAG213/215/216 datasheets — the
// commands are identical across the family (WRITE = 0xA2, PWD_AUTH =
// 0x1B), but the configuration / password / PACK pages live at chip-
// specific addresses. The caller passes a NtagPages config — usually
// obtained from `pagesForFamily(family)` — and the builders emit the
// frame the chip expects.
//
// Locks are reversible — the hider's PIN derives back from PWD via
// `pwdToPin`, and `buildDisableAuthFrame` clears AUTH0 once the hider
// re-authenticates.
//
// Issue #567 — the older `Ndef.makeReadOnly()` path we replace was a
// one-way OTP lock and gave the hider no path back to rewriting the
// tag. Copilot review on PR #572 asked the lock module to handle 213
// + 216 too rather than hard-coding NTAG215 addresses; this is that
// refactor.

// NTAG21x family the lock module supports. NTAG213 is rejected by the
// runtime (too small for the multi-record Hunt payload) but kept in
// the type so we can surface a clear error rather than a write
// failure deep in the call stack.
export type NtagFamily = 'ntag-213' | 'ntag-215' | 'ntag-216';

// Chip-specific page layout. NTAG21x is 4-byte pages, user memory
// starting at page 4, configuration + password at the tail of memory.
// Per the datasheets (rev 3.2 §8 for 215, §8 for 216, §8 for 213).
export interface NtagPages {
  family: NtagFamily;
  // First and last user-memory page (inclusive). 213: 0x04-0x27,
  // 215: 0x04-0x81, 216: 0x04-0xE1. The TLV envelope + NDEF payload
  // must fit within this window; anything beyond bleeds into the
  // dynamic-lock/config pages and will brick the tag.
  userPageFirst: number;
  userPageLast: number;
  // Configuration pages, in write order.
  cfg0: number;
  cfg1: number;
  pwd: number;
  pack: number;
  // OTP dynamic-lock page — one-way lock bits for the high half of
  // user memory (pages 16+). 213: 0x28, 215: 0x82, 216: 0xE2. Read
  // by the diagnostic to tell the hider whether their tag is
  // recoverable (PWD-protected) or bricked (OTP-locked).
  dynamicLockPage: number;
}

const NTAG_PAGES: Record<NtagFamily, NtagPages> = {
  'ntag-213': {
    family: 'ntag-213',
    userPageFirst: 0x04,
    userPageLast: 0x27,
    cfg0: 0x29,
    cfg1: 0x2a,
    pwd: 0x2b,
    pack: 0x2c,
    dynamicLockPage: 0x28,
  },
  'ntag-215': {
    family: 'ntag-215',
    userPageFirst: 0x04,
    userPageLast: 0x81,
    cfg0: 0x83,
    cfg1: 0x84,
    pwd: 0x85,
    pack: 0x86,
    dynamicLockPage: 0x82,
  },
  'ntag-216': {
    family: 'ntag-216',
    userPageFirst: 0x04,
    userPageLast: 0xe1,
    cfg0: 0xe3,
    cfg1: 0xe4,
    pwd: 0xe5,
    pack: 0xe6,
    dynamicLockPage: 0xe2,
  },
};

export const pagesForFamily = (family: NtagFamily): NtagPages => NTAG_PAGES[family];

// 4-byte password + 2-byte PACK acknowledge. Generated client-side and
// persisted in piggyStorageService keyed by the tag UID.
export interface LockSecrets {
  pwd: number[];
  pack: number[];
}

// NTAG21x write command per NXP datasheet §10.5.4: WRITE = 0xA2 followed
// by the 1-byte page address and 4 data bytes. Same opcode across the
// family.
const CMD_WRITE = 0xa2;
// PWD_AUTH = 0x1B + 4-byte PWD; tag responds with the 2-byte PACK on
// success, NAK on failure. Section §10.7.
const CMD_PWD_AUTH = 0x1b;
// AUTH0 byte controls the first page that requires authentication for
// writes. User memory starts at page 0x04 on every NTAG21x, so 0x04
// protects all user data while leaving the manufacturer header
// (UID/CC/lock) free. Setting AUTH0 to a page index above the chip's
// last real page disables protection — we use 0xFF for "off" to match
// NXP example code (valid on 213/215/216 because their largest real
// page is well below 0xFF).
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

// WRITE PWD frame: A2 <pwdPage> pwd[0..3]. Bytes 4-7 are the password
// the chip will compare against on PWD_AUTH.
export const buildPwdWriteFrame = (pages: NtagPages, pwd: number[]): number[] => {
  assertByteArray('pwd', pwd, 4);
  return [CMD_WRITE, pages.pwd, ...pwd];
};

// WRITE PACK frame: A2 <packPage> pack[0..1] 00 00. Bytes 6-7 of the
// PACK page are RFUI (must be 0).
export const buildPackWriteFrame = (pages: NtagPages, pack: number[]): number[] => {
  assertByteArray('pack', pack, 2);
  return [CMD_WRITE, pages.pack, pack[0], pack[1], 0x00, 0x00];
};

// WRITE CFG_0 to turn protection on. Page = [MIRROR, RFUI,
// MIRROR_PAGE, AUTH0]. Setting MIRROR=0 + AUTH0=0x04 leaves UID/CC/lock
// pages free and password-gates everything from user-memory page 4 up,
// including PWD/PACK/CFG so a finder can't read them back.
export const buildEnableAuthFrame = (pages: NtagPages): number[] => [
  CMD_WRITE,
  pages.cfg0,
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
export const buildSetAccessFrame = (pages: NtagPages): number[] => [
  CMD_WRITE,
  pages.cfg1,
  0x00,
  0x00,
  0x00,
  0x00,
];

// WRITE CFG_0 to turn protection OFF — sets AUTH0 to a page index above
// the chip's last real page so the password check never triggers. Used
// by `unlockHuntTag` after a successful PWD_AUTH.
export const buildDisableAuthFrame = (pages: NtagPages): number[] => [
  CMD_WRITE,
  pages.cfg0,
  0x00,
  0x00,
  0x00,
  AUTH0_DISABLED,
];

// NTAG21x READ command per NXP datasheet §10.5.3: 0x30 <page>, returns
// 16 bytes (4 consecutive pages). Caller slices the response for the
// page they want.
export const buildReadFrame = (page: number): number[] => [0x30, page & 0xff];

// 8-byte GET_VERSION response (NXP AN11340). Byte 6 carries the
// storage-size identifier we use to pick the right `NtagPages` config.
// Returns null when the bytes aren't a recognisable NTAG21x reply
// (caller decides how to surface "this isn't a chip we support").
export const buildGetVersionFrame = (): number[] => [0x60];

// Diagnose why a tag is rejecting writes. NTAG21x has two layers of
// permanent write protection — neither reversible at the silicon
// level — plus the reversible PWD/PACK lock we own. Reads the OTP
// lock bytes at page 0x02 (static lock, covers CC + pages 0x04-0x0F)
// AND the dynamic lock byte at the family-specific dynamic-lock page
// (215: 0x82, 216: 0xE2, 213: 0x28) AND the CFG_0 byte 3 (AUTH0).
// Returns a tagged result so the caller can branch on whether
// recovery is possible (PWD_AUTH unlock works) or hopeless (OTP
// flipped → buy a fresh chip). Issue #567 / Pixel test session.
export type TagLockState =
  | { kind: 'open' }
  | { kind: 'otp-locked'; pagesLockedFrom: number }
  | { kind: 'pwd-protected'; auth0: number }
  | { kind: 'unknown' };

export const diagnoseTagLockState = (
  staticLockPage: number[], // 4-byte page 0x02 read response
  dynamicLockByte0: number, // byte 0 of family.dynamicLockPage
  auth0: number, // byte 3 of family.cfg0
  pages: NtagPages,
): TagLockState => {
  // Static lock bytes live at page 0x02 bytes 2-3. Byte 2 (LOCK0):
  // bit 3 locks CC (page 0x03); bits 4-7 lock user pages 0x04-0x07.
  // Byte 3 (LOCK1): bits 0-7 lock pages 0x08-0x0F.
  const lock0 = staticLockPage[2];
  const lock1 = staticLockPage[3];
  // Bits 4-7 of LOCK0 = pages 4-7 locked, plus all of LOCK1 = pages
  // 8-15 locked. Any set bit means at least one user page is OTP-
  // locked and the tag is no longer writable in that range.
  const userPagesOtpLocked = ((lock0 & 0xf0) | lock1) !== 0;
  if (userPagesOtpLocked) {
    const firstLocked = (lock0 & 0x10) !== 0 ? 4 : (lock0 & 0x20) !== 0 ? 5 : 6;
    return { kind: 'otp-locked', pagesLockedFrom: firstLocked };
  }
  // Dynamic lock — covers pages 16-end of user memory on 215/216. A
  // non-zero byte means at least one 8-page block of dynamic memory
  // is OTP-locked.
  if (dynamicLockByte0 !== 0) {
    return { kind: 'otp-locked', pagesLockedFrom: 16 };
  }
  // AUTH0 < first invalid page means PWD/PACK is gating writes. The
  // hider can recover by entering the right Piglet's Edit → Unlock
  // flow (if they have the PIN).
  if (auth0 <= pages.userPageLast) {
    return { kind: 'pwd-protected', auth0 };
  }
  return { kind: 'open' };
};

export const familyFromGetVersion = (response: number[]): NtagFamily | null => {
  if (response.length < 7) return null;
  // Vendor (byte 1) must be NXP = 0x04, product (byte 2) = 0x04.
  if (response[1] !== 0x04 || response[2] !== 0x04) return null;
  switch (response[6]) {
    case 0x0f:
      return 'ntag-213';
    case 0x11:
      return 'ntag-215';
    case 0x13:
      return 'ntag-216';
    default:
      return null;
  }
};

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
