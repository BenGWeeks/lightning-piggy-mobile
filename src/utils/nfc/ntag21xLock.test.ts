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
  pagesForFamily,
  buildGetVersionFrame,
  familyFromGetVersion,
  diagnoseTagLockState,
} from './ntag21xLock';

const ntag215 = pagesForFamily('ntag-215');
const ntag216 = pagesForFamily('ntag-216');
const ntag213 = pagesForFamily('ntag-213');

describe('ntag21xLock byte builders (NTAG215)', () => {
  it('builds the PWD write frame at page 0x85', () => {
    const frame = buildPwdWriteFrame(ntag215, [0xde, 0xad, 0xbe, 0xef]);
    expect(frame).toEqual([0xa2, 0x85, 0xde, 0xad, 0xbe, 0xef]);
  });

  it('builds the PACK write frame at page 0x86 with RFUI zeros', () => {
    const frame = buildPackWriteFrame(ntag215, [0xca, 0xfe]);
    expect(frame).toEqual([0xa2, 0x86, 0xca, 0xfe, 0x00, 0x00]);
  });

  it('enable-auth frame protects from user-memory page 0x04 onwards', () => {
    expect(buildEnableAuthFrame(ntag215)).toEqual([0xa2, 0x83, 0x00, 0x00, 0x00, 0x04]);
  });

  it('set-access frame leaves reads open (PROT=0) and CFG unfrozen (CFGLCK=0)', () => {
    expect(buildSetAccessFrame(ntag215)).toEqual([0xa2, 0x84, 0x00, 0x00, 0x00, 0x00]);
  });

  it('disable-auth frame parks AUTH0 above the last real page', () => {
    expect(buildDisableAuthFrame(ntag215)).toEqual([0xa2, 0x83, 0x00, 0x00, 0x00, 0xff]);
  });

  it('PWD_AUTH frame is 0x1B + the 4 password bytes', () => {
    expect(buildPwdAuthFrame([0x01, 0x02, 0x03, 0x04])).toEqual([0x1b, 0x01, 0x02, 0x03, 0x04]);
  });

  it('rejects malformed PWD lengths so callers fail fast instead of bricking a tag', () => {
    expect(() => buildPwdWriteFrame(ntag215, [0xde, 0xad])).toThrow(/4 bytes/);
    expect(() => buildPackWriteFrame(ntag215, [0xca, 0xfe, 0x00])).toThrow(/2 bytes/);
    expect(() => buildPwdAuthFrame([1, 2, 3, 4, 5])).toThrow(/4 bytes/);
  });

  it('rejects out-of-range byte values (signed JS numbers, fractional, NaN)', () => {
    expect(() => buildPwdWriteFrame(ntag215, [-1, 0, 0, 0])).toThrow(/non-byte/);
    expect(() => buildPwdWriteFrame(ntag215, [256, 0, 0, 0])).toThrow(/non-byte/);
    expect(() => buildPwdWriteFrame(ntag215, [1.5, 0, 0, 0])).toThrow(/non-byte/);
    expect(() => buildPwdWriteFrame(ntag215, [NaN, 0, 0, 0])).toThrow(/non-byte/);
  });
});

describe('ntag21xLock byte builders (NTAG216 — different page addresses)', () => {
  it('builds NTAG216 PWD frame at page 0xE5', () => {
    expect(buildPwdWriteFrame(ntag216, [0xde, 0xad, 0xbe, 0xef])).toEqual([
      0xa2, 0xe5, 0xde, 0xad, 0xbe, 0xef,
    ]);
  });

  it('builds NTAG216 PACK frame at page 0xE6', () => {
    expect(buildPackWriteFrame(ntag216, [0xca, 0xfe])).toEqual([
      0xa2, 0xe6, 0xca, 0xfe, 0x00, 0x00,
    ]);
  });

  it('NTAG216 enable-auth lands on CFG_0 = 0xE3', () => {
    expect(buildEnableAuthFrame(ntag216)).toEqual([0xa2, 0xe3, 0x00, 0x00, 0x00, 0x04]);
  });

  it('NTAG216 access frame writes CFG_1 = 0xE4', () => {
    expect(buildSetAccessFrame(ntag216)).toEqual([0xa2, 0xe4, 0x00, 0x00, 0x00, 0x00]);
  });

  it('NTAG216 user pages run 0x04..0xE1 (222 pages, 888 bytes)', () => {
    expect(ntag216.userPageFirst).toBe(0x04);
    expect(ntag216.userPageLast).toBe(0xe1);
    expect(ntag216.userPageLast - ntag216.userPageFirst + 1).toBe(222);
  });

  it('NTAG213 user pages run 0x04..0x27 (36 pages, 144 bytes)', () => {
    expect(ntag213.userPageFirst).toBe(0x04);
    expect(ntag213.userPageLast).toBe(0x27);
    expect(ntag213.userPageLast - ntag213.userPageFirst + 1).toBe(36);
  });
});

describe('GET_VERSION family detection', () => {
  it('emits the single-byte 0x60 command frame', () => {
    expect(buildGetVersionFrame()).toEqual([0x60]);
  });

  it('decodes NTAG213 storage byte (0x0F)', () => {
    expect(familyFromGetVersion([0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x0f, 0x03])).toBe('ntag-213');
  });

  it('decodes NTAG215 storage byte (0x11)', () => {
    expect(familyFromGetVersion([0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x11, 0x03])).toBe('ntag-215');
  });

  it('decodes NTAG216 storage byte (0x13)', () => {
    expect(familyFromGetVersion([0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x13, 0x03])).toBe('ntag-216');
  });

  it('returns null for non-NXP vendor byte', () => {
    expect(familyFromGetVersion([0x00, 0x05, 0x04, 0x02, 0x01, 0x00, 0x11, 0x03])).toBeNull();
  });

  it('returns null for non-NTAG product byte', () => {
    expect(familyFromGetVersion([0x00, 0x04, 0x05, 0x02, 0x01, 0x00, 0x11, 0x03])).toBeNull();
  });

  it('returns null for unknown storage size (future chip variant)', () => {
    expect(familyFromGetVersion([0x00, 0x04, 0x04, 0x02, 0x01, 0x00, 0x99, 0x03])).toBeNull();
  });

  it('returns null when the response is too short to read byte 6', () => {
    expect(familyFromGetVersion([0x00, 0x04, 0x04])).toBeNull();
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

  it('consumes 6 bytes of crypto.getRandomValues, mapping 0..3 → pwd and 4..5 → pack', () => {
    // Deterministic spy on the polyfilled crypto so the test asserts
    // the byte-routing without depending on RNG output (Copilot #572
    // review caught the previous probabilistic check). Restores after
    // the call so other tests keep the real generator.
    const original = crypto.getRandomValues.bind(crypto);
    const spy = jest
      .spyOn(crypto, 'getRandomValues')
      .mockImplementation((arr: ArrayBufferView | null) => {
        if (arr instanceof Uint8Array) {
          // Fill with a recognisable, non-symmetric sequence so a
          // wrong slice (e.g. pwd from bytes 2..5) would change the
          // expected output below.
          for (let i = 0; i < arr.length; i++) arr[i] = (i + 1) * 0x11;
        }
        return arr as unknown as ReturnType<typeof crypto.getRandomValues>;
      });
    try {
      const { pwd, pack } = generateLockSecrets();
      expect(pwd).toEqual([0x11, 0x22, 0x33, 0x44]);
      expect(pack).toEqual([0x55, 0x66]);
      expect(spy).toHaveBeenCalledWith(expect.any(Uint8Array));
      const arg = spy.mock.calls[0][0] as Uint8Array;
      expect(arg.length).toBe(6);
    } finally {
      spy.mockRestore();
      // Sanity-restore in case mockRestore couldn't (older jest variants).
      Object.defineProperty(crypto, 'getRandomValues', { value: original, configurable: true });
    }
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
    const aligned = [0xd1, 0x01, 0x02, 0x55, 0x03];
    expect(buildNdefTlvBytes(aligned)).toEqual([0x03, 0x05, 0xd1, 0x01, 0x02, 0x55, 0x03, 0xfe]);
    const padded = [0xd1, 0x01, 0x03, 0x55, 0x03, 0x2f];
    expect(buildNdefTlvBytes(padded)).toEqual([
      0x03, 0x06, 0xd1, 0x01, 0x03, 0x55, 0x03, 0x2f, 0xfe, 0x00, 0x00, 0x00,
    ]);
    expect(buildNdefTlvBytes(padded).length % 4).toBe(0);
  });

  it('uses the 3-byte length form once the NDEF exceeds 254 bytes', () => {
    const ndef = new Array(300).fill(0xaa);
    const tlv = buildNdefTlvBytes(ndef);
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

describe('diagnoseTagLockState', () => {
  // Factory-default chip: lock bytes are 0, AUTH0 is 0xFF (disabled),
  // dynamic lock byte is 0. Should report "open".
  it('reports open for a factory-fresh chip', () => {
    const openPage02 = [0x04, 0x00, 0x00, 0x00];
    expect(diagnoseTagLockState(openPage02, 0x00, 0xff, ntag215)).toEqual({ kind: 'open' });
  });

  // makeReadOnly path: LOCK0 byte 2 sets bit 4 (lock page 0x04) — the
  // first user page is now read-only. Should report otp-locked.
  it('detects static lock bit on page 4 (LOCK0 bit 4)', () => {
    expect(diagnoseTagLockState([0x04, 0x00, 0x10, 0x00], 0x00, 0xff, ntag215)).toEqual({
      kind: 'otp-locked',
      pagesLockedFrom: 4,
    });
  });

  it('detects static lock bit on page 5 (LOCK0 bit 5)', () => {
    expect(diagnoseTagLockState([0x04, 0x00, 0x20, 0x00], 0x00, 0xff, ntag215)).toEqual({
      kind: 'otp-locked',
      pagesLockedFrom: 5,
    });
  });

  it('detects static lock bits across the high byte of LOCK0 (page 7+)', () => {
    expect(diagnoseTagLockState([0x04, 0x00, 0x80, 0x00], 0x00, 0xff, ntag215)).toEqual({
      kind: 'otp-locked',
      pagesLockedFrom: 6,
    });
  });

  it('detects static lock bits in LOCK1 (pages 8-15)', () => {
    expect(diagnoseTagLockState([0x04, 0x00, 0x00, 0x01], 0x00, 0xff, ntag215)).toEqual({
      kind: 'otp-locked',
      pagesLockedFrom: 6,
    });
  });

  // Dynamic lock (page 0x82 on NTAG215) covers user-memory blocks
  // from page 16 up. A non-zero byte means at least one block is
  // OTP-locked.
  it('detects dynamic lock bits (page 16+)', () => {
    expect(diagnoseTagLockState([0x04, 0x00, 0x00, 0x00], 0x01, 0xff, ntag215)).toEqual({
      kind: 'otp-locked',
      pagesLockedFrom: 16,
    });
  });

  // AUTH0 ≤ last user page means the chip is gating writes behind
  // PWD_AUTH. Recoverable via the Edit → Unlock flow.
  it('detects PWD-protection when AUTH0 ≤ last user page', () => {
    expect(diagnoseTagLockState([0x04, 0x00, 0x00, 0x00], 0x00, 0x04, ntag215)).toEqual({
      kind: 'pwd-protected',
      auth0: 0x04,
    });
  });

  // AUTH0 right at the boundary (last user page) should still trip
  // the protected branch.
  it('treats AUTH0 equal to last user page as PWD-protected', () => {
    expect(
      diagnoseTagLockState([0x04, 0x00, 0x00, 0x00], 0x00, ntag215.userPageLast, ntag215),
    ).toEqual({
      kind: 'pwd-protected',
      auth0: ntag215.userPageLast,
    });
  });

  // AUTH0 above the last real page = no protection. Combined with
  // clean lock bytes = open.
  it('treats AUTH0 above the last real page as open', () => {
    expect(diagnoseTagLockState([0x04, 0x00, 0x00, 0x00], 0x00, 0x87, ntag215)).toEqual({
      kind: 'open',
    });
  });

  // OTP lock wins over PWD when both are set — the OTP bits are
  // irreversible so the hider's recovery options are different.
  it('prefers OTP-locked over PWD-protected when both are present', () => {
    const state = diagnoseTagLockState([0x04, 0x00, 0x10, 0x00], 0x00, 0x04, ntag215);
    expect(state.kind).toBe('otp-locked');
  });

  // The NTAG216 pageset has a different `userPageLast` (0xE1) than
  // NTAG215 (0x81). AUTH0=0x82 is one past 215's last user page so
  // protection is OFF on 215, but it's well inside 216's user range
  // so protection is ON on 216 — same byte, different verdict per
  // chip family.
  it('honours the family-specific userPageLast boundary', () => {
    expect(diagnoseTagLockState([0x04, 0x00, 0x00, 0x00], 0x00, 0x82, ntag216)).toEqual({
      kind: 'pwd-protected',
      auth0: 0x82,
    });
    expect(diagnoseTagLockState([0x04, 0x00, 0x00, 0x00], 0x00, 0x82, ntag215)).toEqual({
      kind: 'open',
    });
  });
});
