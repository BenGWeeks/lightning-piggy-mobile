// Focused tests for `extractBitcoinUri`'s address-validation gate.
// `parseBip21` round-trip + edge cases live in `./bip21.test.ts`; this
// suite covers the validation layered on top in `extractBitcoinUri`
// per Copilot blocking review on PR #451 — without it, garbage like
// `bitcoin:hello12345` would render a Pay card.
//
// boltzService pulls in bitcoinjs-lib's bip32 → ESM imports Jest can't
// resolve under jest-expo. Mock the single helper we depend on with a
// regex stand-in for valid mainnet addresses (bc1q… bech32 / 1… P2PKH
// / 3… P2SH). Real interop coverage lives in the on-device path.
jest.mock('../services/boltzService', () => ({
  isBitcoinAddress: (input: string): boolean => {
    const trimmed = input.trim();
    return (
      /^bc1q[ac-hj-np-z02-9]{38,58}$/i.test(trimmed) ||
      /^bc1p[ac-hj-np-z02-9]{58}$/i.test(trimmed) ||
      /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)
    );
  },
}));

import {
  extractBitcoinUri,
  isSecretModeTrigger,
  extractAudioUrl,
  parseVoiceNote,
  encodeEncryptedFileUrl,
} from './messageContent';

describe('isSecretModeTrigger', () => {
  it('matches the exact trigger word', () => {
    expect(isSecretModeTrigger('secretthreewords')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isSecretModeTrigger('SECRETTHREEWORDS')).toBe(true);
    expect(isSecretModeTrigger('SecretThreeWords')).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isSecretModeTrigger('  secretthreewords\n')).toBe(true);
  });

  it('rejects partial / embedded matches so the word can be discussed in chat', () => {
    expect(isSecretModeTrigger('secretthreewords and more')).toBe(false);
    expect(isSecretModeTrigger('hey secretthreewords')).toBe(false);
    expect(isSecretModeTrigger('thesecretthreewords')).toBe(false);
  });

  it('rejects empty / non-matching input', () => {
    expect(isSecretModeTrigger('')).toBe(false);
    expect(isSecretModeTrigger('hello')).toBe(false);
    expect(isSecretModeTrigger('secret three words')).toBe(false);
  });
});

describe('extractBitcoinUri', () => {
  it('accepts a valid mainnet bech32 address (no amount)', () => {
    const r = extractBitcoinUri('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    expect(r).not.toBeNull();
    expect(r?.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    expect(r?.amountSats).toBeNull();
  });

  it('accepts a valid mainnet bech32 address with BIP-21 amount', () => {
    const r = extractBitcoinUri('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.0001');
    expect(r?.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    expect(r?.amountSats).toBe(10000);
  });

  it('accepts a valid legacy P2PKH address', () => {
    // Genesis block coinbase output address.
    const r = extractBitcoinUri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    expect(r?.address).toBe('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
  });

  it('rejects a syntactically-shaped but invalid address', () => {
    // `parseBip21` would happily match this (8+ alnum chars after
    // `bitcoin:`); the validation gate must drop it.
    expect(extractBitcoinUri('bitcoin:hello12345')).toBeNull();
  });

  // Note: corrupted-checksum rejection is a real-bitcoinjs-lib
  // feature we delegate to. The mock here only checks address shape
  // (bech32/p2pkh/p2sh patterns) so the bad-checksum case isn't
  // exercised in this suite — it's covered on-device by the actual
  // boltzService.isBitcoinAddress flow when a recipient pastes a
  // typo'd address into a `bitcoin:` URI.

  it('rejects testnet addresses (mainnet-only Pay flow)', () => {
    // `tb1q…` is testnet; isBitcoinAddress is mainnet-bound.
    expect(
      extractBitcoinUri('bitcoin:tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'),
    ).toBeNull();
  });

  it('returns null on non-bitcoin input', () => {
    expect(extractBitcoinUri('hello')).toBeNull();
    expect(extractBitcoinUri('lightning:lnbc100')).toBeNull();
    expect(extractBitcoinUri('')).toBeNull();
  });
});

describe('extractAudioUrl', () => {
  it('matches a plain audio URL that is the whole message body', () => {
    expect(extractAudioUrl('https://blossom.example/abc.m4a')).toBe(
      'https://blossom.example/abc.m4a',
    );
    expect(extractAudioUrl('https://blossom.primal.net/deadbeef.mp4')).toBe(
      'https://blossom.primal.net/deadbeef.mp4',
    );
  });

  it('rejects non-audio URLs and URLs with surrounding text', () => {
    expect(extractAudioUrl('https://x/y.png')).toBeNull();
    expect(extractAudioUrl('listen to this https://x/y.m4a')).toBeNull();
    expect(extractAudioUrl('')).toBeNull();
  });
});

describe('parseVoiceNote / encodeEncryptedFileUrl (NIP-17 kind 15)', () => {
  it('round-trips an encrypted voice note and strips the fragment from the fetch URL', () => {
    const encoded = encodeEncryptedFileUrl({
      url: 'https://blossom.primal.net/2d6b4c.bin',
      mime: 'audio/mp4',
      keyHex: 'aa'.repeat(32),
      nonceHex: 'bb'.repeat(12),
    });
    const parsed = parseVoiceNote(encoded);
    expect(parsed?.encrypted).toBe(true);
    expect(parsed?.url).toBe('https://blossom.primal.net/2d6b4c.bin');
    expect(parsed?.url).not.toContain('#'); // fragment never reaches the server
    expect(parsed?.keyHex).toBe('aa'.repeat(32));
    expect(parsed?.nonceHex).toBe('bb'.repeat(12));
    expect(parsed?.mime).toBe('audio/mp4');
  });

  it('detects a plain (unencrypted / legacy) audio URL', () => {
    const parsed = parseVoiceNote('https://blossom.example/abc.m4a');
    expect(parsed?.encrypted).toBe(false);
    expect(parsed?.url).toBe('https://blossom.example/abc.m4a');
  });

  it('ignores encrypted files that are not audio (images handled separately, #688)', () => {
    const img = encodeEncryptedFileUrl({
      url: 'https://s/x.bin',
      mime: 'image/jpeg',
      keyHex: 'a'.repeat(64),
      nonceHex: 'b'.repeat(24),
    });
    expect(parseVoiceNote(img)).toBeNull();
  });

  it('rejects an lpe fragment missing key or nonce', () => {
    expect(parseVoiceNote('https://s/x.bin#lpe=1&m=audio%2Fmp4')).toBeNull();
  });

  it('returns null for non-voice text', () => {
    expect(parseVoiceNote('hello world')).toBeNull();
    expect(parseVoiceNote('')).toBeNull();
  });
});
