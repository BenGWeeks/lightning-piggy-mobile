import {
  buildPwdWriteFrame,
  buildPackWriteFrame,
  buildEnableAuthFrame,
  buildSetAccessFrame,
  buildDisableAuthFrame,
  buildPwdAuthFrame,
  buildNdefTlvBytes,
  splitIntoPages,
  generateLockSecrets,
  pwdToPin,
  pinToPwd,
  packToHex,
  hexToBytes,
} from './ntag215Lock';

describe('ntag215Lock byte builders', () => {
  it('builds the PWD write frame at page 0x85', () => {
    const frame = buildPwdWriteFrame([0xde, 0xad, 0xbe, 0xef]);
    expect(frame).toEqual([0xa2, 0x85, 0xde, 0xad, 0xbe, 0xef]);
  });

  it('builds the PACK write frame at page 0x86 with RFUI zeros', () => {
    const frame = buildPackWriteFrame([0xca, 0xfe]);
    expect(frame).toEqual([0xa2, 0x86, 0xca, 0xfe, 0x00, 0x00]);
  });

  it('enable-auth frame protects from user-memory page 0x04 onwards', () => {
    // [WRITE, CFG_0, MIRROR=0, RFUI=0, MIRROR_PAGE=0, AUTH0=0x04]
    expect(buildEnableAuthFrame()).toEqual([0xa2, 0x83, 0x00, 0x00, 0x00, 0x04]);
  });

  it('set-access frame leaves reads open (PROT=0) and CFG unfrozen (CFGLCK=0)', () => {
    expect(buildSetAccessFrame()).toEqual([0xa2, 0x84, 0x00, 0x00, 0x00, 0x00]);
  });

  it('disable-auth frame parks AUTH0 above the last real page', () => {
    expect(buildDisableAuthFrame()).toEqual([0xa2, 0x83, 0x00, 0x00, 0x00, 0xff]);
  });

  it('PWD_AUTH frame is 0x1B + the 4 password bytes', () => {
    expect(buildPwdAuthFrame([0x01, 0x02, 0x03, 0x04])).toEqual([0x1b, 0x01, 0x02, 0x03, 0x04]);
  });

  it('rejects malformed PWD lengths so callers fail fast instead of bricking a tag', () => {
    expect(() => buildPwdWriteFrame([0xde, 0xad])).toThrow(/4 bytes/);
    expect(() => buildPackWriteFrame([0xca, 0xfe, 0x00])).toThrow(/2 bytes/);
    expect(() => buildPwdAuthFrame([1, 2, 3, 4, 5])).toThrow(/4 bytes/);
  });

  it('rejects out-of-range byte values (signed JS numbers, fractional, NaN)', () => {
    expect(() => buildPwdWriteFrame([-1, 0, 0, 0])).toThrow(/non-byte/);
    expect(() => buildPwdWriteFrame([256, 0, 0, 0])).toThrow(/non-byte/);
    expect(() => buildPwdWriteFrame([1.5, 0, 0, 0])).toThrow(/non-byte/);
    expect(() => buildPwdWriteFrame([NaN, 0, 0, 0])).toThrow(/non-byte/);
  });
});

describe('PWD random-byte generator', () => {
  it('emits 4 PWD + 2 PACK bytes, all in [0, 255]', () => {
    const { pwd, pack } = generateLockSecrets();
    expect(pwd).toHaveLength(4);
    expect(pack).toHaveLength(2);
    for (const b of [...pwd, ...pack]) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(0xff);
      expect(Number.isInteger(b)).toBe(true);
    }
  });

  it('does not repeat across calls (sanity check on RNG plumbing)', () => {
    const a = generateLockSecrets();
    const b = generateLockSecrets();
    // Collision odds at random are 1/2^48 — if this ever flakes, the
    // polyfill has regressed to a constant source and many other things
    // are also broken.
    expect([...a.pwd, ...a.pack]).not.toEqual([...b.pwd, ...b.pack]);
  });
});

describe('PIN encoding round-trips', () => {
  it('pwdToPin emits 8 uppercase hex chars', () => {
    expect(pwdToPin([0x0a, 0xbc, 0xde, 0xff])).toBe('0ABCDEFF');
  });

  it('pinToPwd round-trips clean input', () => {
    expect(pinToPwd('DEADBEEF')).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('pinToPwd tolerates whitespace, casing, and 0x prefix', () => {
    expect(pinToPwd(' 0xDEAD beef ')).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(pinToPwd('deadbeef')).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('pinToPwd rejects non-hex / wrong-length input', () => {
    expect(() => pinToPwd('DEADBEEX')).toThrow(/8 hex/);
    expect(() => pinToPwd('DEADBE')).toThrow(/8 hex/);
    expect(() => pinToPwd('')).toThrow(/8 hex/);
  });

  it('packToHex + hexToBytes are inverses', () => {
    expect(packToHex([0xab, 0xcd])).toBe('ABCD');
    expect(hexToBytes('ABCD', 2)).toEqual([0xab, 0xcd]);
  });
});

describe('NDEF TLV wrapping', () => {
  it('wraps a short message with the 1-byte length form + terminator + page padding', () => {
    // 5 NDEF bytes + [type, len, terminator] = 8 → already page-aligned.
    const aligned = [0xd1, 0x01, 0x02, 0x55, 0x03];
    expect(buildNdefTlvBytes(aligned)).toEqual([0x03, 0x05, 0xd1, 0x01, 0x02, 0x55, 0x03, 0xfe]);
    // 6 NDEF bytes + 3 envelope = 9 → pads up to 12 with three zeros.
    const padded = [0xd1, 0x01, 0x03, 0x55, 0x03, 0x2f];
    expect(buildNdefTlvBytes(padded)).toEqual([
      0x03, 0x06, 0xd1, 0x01, 0x03, 0x55, 0x03, 0x2f, 0xfe, 0x00, 0x00, 0x00,
    ]);
    expect(buildNdefTlvBytes(padded).length % 4).toBe(0);
  });

  it('uses the 3-byte length form once the NDEF exceeds 254 bytes', () => {
    const ndef = new Array(300).fill(0xaa);
    const tlv = buildNdefTlvBytes(ndef);
    // [03, FF, hi, lo, ...300 bytes..., FE, padding...]
    expect(tlv[0]).toBe(0x03);
    expect(tlv[1]).toBe(0xff);
    expect((tlv[2] << 8) | tlv[3]).toBe(300);
    expect(tlv[4 + 300]).toBe(0xfe);
    expect(tlv.length % 4).toBe(0);
  });

  it('splits into 4-byte pages in order', () => {
    const bytes = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(splitIntoPages(bytes)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
  });

  it('rejects a non-aligned byte stream so callers fix the input, not silently truncate', () => {
    expect(() => splitIntoPages([1, 2, 3])).toThrow(/page-aligned/);
  });
});
