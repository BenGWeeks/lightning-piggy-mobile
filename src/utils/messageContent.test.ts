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
  parseImageMessage,
  encodeEncryptedFileUrl,
  deriveGroupWireKind,
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

  it('does not treat a near-miss marker like lpe=10 as an encrypted note', () => {
    // A substring test for "lpe=1" would wrongly fire on "lpe=10"; the
    // parser requires the param to equal exactly "1".
    expect(
      parseVoiceNote(
        `https://s/x.bin#lpe=10&k=${'a'.repeat(64)}&n=${'b'.repeat(24)}&m=audio%2Fmp4`,
      ),
    ).toBeNull();
  });

  it('rejects an lpe fragment whose alg is not aes-gcm (we only implement GCM)', () => {
    // A non-aes-gcm kind-15 file would render a player that then fails on
    // play — fall back to plain text instead.
    expect(
      parseVoiceNote(
        `https://s/x.bin#lpe=1&alg=chacha20&k=${'a'.repeat(64)}&n=${'b'.repeat(24)}&m=audio%2Fmp4`,
      ),
    ).toBeNull();
  });

  it('tolerates a missing alg param (defaults to aes-gcm)', () => {
    const parsed = parseVoiceNote(
      `https://s/x.bin#lpe=1&k=${'a'.repeat(64)}&n=${'b'.repeat(24)}&m=audio%2Fmp4`,
    );
    expect(parsed?.encrypted).toBe(true);
  });

  it('strips a pre-existing fragment on the source URL instead of double-#', () => {
    const encoded = encodeEncryptedFileUrl({
      url: 'https://blossom.example/abc.bin#already-here',
      mime: 'audio/mp4',
      keyHex: 'aa'.repeat(32),
      nonceHex: 'bb'.repeat(12),
    });
    // Exactly one '#', and the parser recovers the clean URL + params.
    expect(encoded.match(/#/g)?.length).toBe(1);
    const parsed = parseVoiceNote(encoded);
    expect(parsed?.encrypted).toBe(true);
    expect(parsed?.url).toBe('https://blossom.example/abc.bin');
  });

  it('returns null for non-voice text', () => {
    expect(parseVoiceNote('hello world')).toBeNull();
    expect(parseVoiceNote('')).toBeNull();
  });
});

describe('parseImageMessage (NIP-17 kind 15, #688)', () => {
  it('round-trips an encrypted image and strips the fragment from the fetch URL', () => {
    const encoded = encodeEncryptedFileUrl({
      url: 'https://blossom.primal.net/abc123.bin',
      mime: 'image/jpeg',
      keyHex: 'aa'.repeat(32),
      nonceHex: 'bb'.repeat(12),
    });
    const parsed = parseImageMessage(encoded);
    expect(parsed?.encrypted).toBe(true);
    expect(parsed?.url).toBe('https://blossom.primal.net/abc123.bin');
    expect(parsed?.url).not.toContain('#'); // fragment never reaches the server
    expect(parsed?.keyHex).toBe('aa'.repeat(32));
    expect(parsed?.nonceHex).toBe('bb'.repeat(12));
    expect(parsed?.mime).toBe('image/jpeg');
  });

  it('round-trips an encrypted PNG (mime preserved for the data: URI)', () => {
    const encoded = encodeEncryptedFileUrl({
      url: 'https://s/x.bin',
      mime: 'image/png',
      keyHex: 'a'.repeat(64),
      nonceHex: 'b'.repeat(24),
    });
    const parsed = parseImageMessage(encoded);
    expect(parsed?.encrypted).toBe(true);
    expect(parsed?.mime).toBe('image/png');
  });

  it('detects a plain (unencrypted / legacy / other-client) image URL', () => {
    const parsed = parseImageMessage('https://example.com/cat.jpg');
    expect(parsed?.encrypted).toBe(false);
    expect(parsed?.url).toBe('https://example.com/cat.jpg');
  });

  it('detects a plain image URL with a query string', () => {
    const parsed = parseImageMessage('https://cdn.example/p.png?w=640');
    expect(parsed?.encrypted).toBe(false);
    expect(parsed?.url).toBe('https://cdn.example/p.png?w=640');
  });

  it('ignores encrypted files that are not images (audio handled by parseVoiceNote)', () => {
    const audio = encodeEncryptedFileUrl({
      url: 'https://s/x.bin',
      mime: 'audio/mp4',
      keyHex: 'a'.repeat(64),
      nonceHex: 'b'.repeat(24),
    });
    expect(parseImageMessage(audio)).toBeNull();
  });

  it('rejects an encrypted-image lpe fragment missing key or nonce', () => {
    expect(parseImageMessage('https://s/x.bin#lpe=1&m=image%2Fjpeg')).toBeNull();
    expect(
      parseImageMessage(`https://s/x.bin#lpe=1&k=${'a'.repeat(64)}&m=image%2Fjpeg`),
    ).toBeNull();
  });

  it('rejects an lpe fragment whose alg is not aes-gcm (we only implement GCM)', () => {
    expect(
      parseImageMessage(
        `https://s/x.bin#lpe=1&alg=chacha20&k=${'a'.repeat(64)}&n=${'b'.repeat(24)}&m=image%2Fjpeg`,
      ),
    ).toBeNull();
  });

  it('does not treat a near-miss marker like lpe=10 as an encrypted image', () => {
    expect(
      parseImageMessage(
        `https://s/x.png#lpe=10&k=${'a'.repeat(64)}&n=${'b'.repeat(24)}&m=image%2Fpng`,
      ),
    ).toBeNull();
  });

  it('returns null for non-image text', () => {
    expect(parseImageMessage('hello world')).toBeNull();
    expect(parseImageMessage('https://example.com/clip.m4a')).toBeNull();
    expect(parseImageMessage('')).toBeNull();
  });
});

describe('deriveGroupWireKind (NIP-17 group kind 14 chat vs kind 15 file)', () => {
  it('returns 15 for an encrypted voice-note (kind-15 file) payload', () => {
    const encoded = encodeEncryptedFileUrl({
      url: 'https://blossom.primal.net/voice.bin',
      mime: 'audio/mp4',
      keyHex: 'aa'.repeat(32),
      nonceHex: 'bb'.repeat(12),
    });
    expect(deriveGroupWireKind(encoded)).toBe(15);
  });

  it('returns 15 for an encrypted image (kind-15 file) payload', () => {
    const encoded = encodeEncryptedFileUrl({
      url: 'https://blossom.primal.net/pic.bin',
      mime: 'image/jpeg',
      keyHex: 'aa'.repeat(32),
      nonceHex: 'bb'.repeat(12),
    });
    expect(deriveGroupWireKind(encoded)).toBe(15);
  });

  it('returns 14 for a plain chat text message', () => {
    expect(deriveGroupWireKind('gm everyone')).toBe(14);
    expect(deriveGroupWireKind('')).toBe(14);
  });

  it('returns 14 for a plain (unencrypted) media URL pasted as chat text', () => {
    // A plain URL is sent as a kind-14 chat message, not a kind-15 encrypted
    // file — only our `#lpe=1` encrypted payloads are kind-15.
    expect(deriveGroupWireKind('https://example.com/cat.jpg')).toBe(14);
    expect(deriveGroupWireKind('https://blossom.example/abc.m4a')).toBe(14);
  });

  it('returns 14 for a malformed lpe fragment (falls back to chat)', () => {
    // Missing key/nonce → not a valid encrypted file → treated as kind-14.
    expect(deriveGroupWireKind('https://s/x.bin#lpe=1&m=audio%2Fmp4')).toBe(14);
  });
});
