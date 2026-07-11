/**
 * Native-routing tests for the nostrCrypto facade (#1046, Stage 2 M1).
 * The native module is mocked — real byte-level equivalence against
 * rust-nostr is exercised on-device by src/utils/nostrCryptoBench.ts and
 * the EXPO_PUBLIC_NATIVE_CRYPTO_XCHECK mode; here we verify the routing,
 * fallback, memoisation, and cross-check reporting logic.
 */
import { bytesToHex } from '@noble/hashes/utils.js';
import * as nip44 from 'nostr-tools/nip44';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifiedSymbol,
  type Event as NostrEvent,
} from 'nostr-tools/pure';

import { getNostrNative, type NostrNativeApi } from '../../modules/nostr-native';
import {
  __setNostrCryptoFlagsForTests,
  isNativeCryptoActive,
  nip44DecryptFrom,
  nip44EncryptForRecipient,
  nostrVerifyEvent,
  warmUpNativeCrypto,
} from './nostrCrypto';

jest.mock('../../modules/nostr-native', () => ({
  getNostrNative: jest.fn(() => null),
}));

const mockGetNostrNative = getNostrNative as jest.MockedFunction<typeof getNostrNative>;

// Real vectors built with the same JS crypto the facade delegates to, so
// JS-path assertions test true byte-level behaviour, not mocks.
const secretKey = generateSecretKey();
const secretKeyHex = bytesToHex(secretKey);
const counterpartySecret = generateSecretKey();
const counterpartyPubkeyHex = getPublicKey(counterpartySecret);
const conversationKey = nip44.v2.utils.getConversationKey(secretKey, counterpartyPubkeyHex);
const plaintext = 'the piggy oinks at midnight';
const ciphertext = nip44.v2.encrypt(plaintext, conversationKey);

function makeSignedEvent(): NostrEvent & { [verifiedSymbol]?: boolean } {
  // finalizeEvent pre-stamps verifiedSymbol: true — strip it so these tests
  // exercise the actual verify paths, like a relay-delivered (JSON-parsed)
  // event would.
  const event = finalizeEvent(
    { kind: 1, created_at: 1730000000, tags: [], content: 'oink' },
    generateSecretKey(),
  ) as NostrEvent & { [verifiedSymbol]?: boolean };
  delete event[verifiedSymbol];
  return event;
}

function mockNative(overrides: Partial<NostrNativeApi> = {}): jest.Mocked<NostrNativeApi> {
  const native = {
    warmUp: jest.fn(async () => true),
    nip44Encrypt: jest.fn(() => 'native-payload'),
    nip44Decrypt: jest.fn(() => 'native-plaintext'),
    schnorrSign: jest.fn(() => 'native-signature'),
    schnorrVerify: jest.fn(() => true),
    ...overrides,
  } as jest.Mocked<NostrNativeApi>;
  mockGetNostrNative.mockReturnValue(native);
  return native;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetNostrNative.mockReturnValue(null);
  __setNostrCryptoFlagsForTests({ native: false, xcheck: false });
});

describe("JS path (flag off — today's default)", () => {
  it('never consults the native module', () => {
    mockNative();
    __setNostrCryptoFlagsForTests({ native: false });
    nip44DecryptFrom(ciphertext, secretKey, counterpartyPubkeyHex);
    nostrVerifyEvent(makeSignedEvent());
    expect(mockGetNostrNative).not.toHaveBeenCalled();
    expect(isNativeCryptoActive()).toBe(false);
  });

  it('nip44DecryptFrom matches derive-key-then-decrypt byte-for-byte', () => {
    expect(nip44DecryptFrom(ciphertext, secretKey, counterpartyPubkeyHex)).toBe(plaintext);
  });

  it('nip44EncryptForRecipient round-trips through nostr-tools', () => {
    const payload = nip44EncryptForRecipient(plaintext, secretKey, counterpartyPubkeyHex);
    expect(nip44.v2.decrypt(payload, conversationKey)).toBe(plaintext);
  });

  it('throws on a tampered payload (MAC failure) like nostr-tools', () => {
    const tampered = `${ciphertext.slice(0, -4)}AAA=`;
    expect(() => nip44DecryptFrom(tampered, secretKey, counterpartyPubkeyHex)).toThrow();
  });

  it('warmUpNativeCrypto resolves false when routing is off', async () => {
    await expect(warmUpNativeCrypto()).resolves.toBe(false);
  });
});

describe('native routing (flag on)', () => {
  beforeEach(() => {
    __setNostrCryptoFlagsForTests({ native: true });
  });

  it('falls back to JS when the module is not linked', () => {
    mockGetNostrNative.mockReturnValue(null);
    expect(nip44DecryptFrom(ciphertext, secretKey, counterpartyPubkeyHex)).toBe(plaintext);
    expect(isNativeCryptoActive()).toBe(false);
  });

  it('routes nip44 ops to the native module with hex-string args', () => {
    const native = mockNative();
    expect(nip44DecryptFrom(ciphertext, secretKey, counterpartyPubkeyHex)).toBe('native-plaintext');
    expect(nip44EncryptForRecipient(plaintext, secretKey, counterpartyPubkeyHex)).toBe(
      'native-payload',
    );
    expect(native.nip44Decrypt).toHaveBeenCalledWith(
      secretKeyHex,
      counterpartyPubkeyHex,
      ciphertext,
    );
    expect(native.nip44Encrypt).toHaveBeenCalledWith(
      secretKeyHex,
      counterpartyPubkeyHex,
      plaintext,
    );
    expect(isNativeCryptoActive()).toBe(true);
  });

  it('lowercases pubkeys before hitting native', () => {
    const native = mockNative();
    nip44DecryptFrom(ciphertext, secretKey, counterpartyPubkeyHex.toUpperCase());
    expect(native.nip44Decrypt).toHaveBeenCalledWith(
      secretKeyHex,
      counterpartyPubkeyHex,
      ciphertext,
    );
  });

  it('propagates native decrypt errors without retrying on JS', () => {
    const native = mockNative({
      nip44Decrypt: jest.fn(() => {
        throw new Error('MAC failure');
      }),
    });
    expect(() => nip44DecryptFrom(ciphertext, secretKey, counterpartyPubkeyHex)).toThrow(
      'MAC failure',
    );
    expect(native.nip44Decrypt).toHaveBeenCalledTimes(1);
  });

  it('nostrVerifyEvent routes the schnorr check natively and memoises via verifiedSymbol', () => {
    const native = mockNative();
    const event = makeSignedEvent();
    expect(nostrVerifyEvent(event)).toBe(true);
    expect(native.schnorrVerify).toHaveBeenCalledWith(event.sig, event.id, event.pubkey);
    expect(event[verifiedSymbol]).toBe(true);
    // Memoised: a second verify must not re-enter native.
    expect(nostrVerifyEvent(event)).toBe(true);
    expect(native.schnorrVerify).toHaveBeenCalledTimes(1);
  });

  it('nostrVerifyEvent fails an id/hash mismatch without calling native schnorr', () => {
    const native = mockNative();
    const event = makeSignedEvent();
    const forged = { ...event, content: 'tampered' };
    expect(nostrVerifyEvent(forged)).toBe(false);
    expect(native.schnorrVerify).not.toHaveBeenCalled();
  });

  it('nostrVerifyEvent normalises native throws to false', () => {
    mockNative({
      schnorrVerify: jest.fn(() => {
        throw new Error('bad input');
      }),
    });
    expect(nostrVerifyEvent(makeSignedEvent())).toBe(false);
  });

  it('warmUpNativeCrypto delegates to the module and never rejects', async () => {
    const native = mockNative({ warmUp: jest.fn(async () => true) });
    await expect(warmUpNativeCrypto()).resolves.toBe(true);
    expect(native.warmUp).toHaveBeenCalled();

    mockNative({
      warmUp: jest.fn(async () => {
        throw new Error('dlopen failed');
      }),
    });
    await expect(warmUpNativeCrypto()).resolves.toBe(false);
  });
});

describe('cross-check mode (dev-only)', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    __setNostrCryptoFlagsForTests({ native: true, xcheck: true });
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('stays silent when native decrypt matches JS byte-for-byte', () => {
    mockNative({ nip44Decrypt: jest.fn(() => plaintext) });
    expect(nip44DecryptFrom(ciphertext, secretKey, counterpartyPubkeyHex)).toBe(plaintext);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('logs loudly when native decrypt diverges from JS', () => {
    mockNative({ nip44Decrypt: jest.fn(() => 'tampered-plaintext') });
    expect(nip44DecryptFrom(ciphertext, secretKey, counterpartyPubkeyHex)).toBe(
      'tampered-plaintext',
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('XCHECK MISMATCH op=nip44DecryptFrom'),
    );
  });

  it('logs when one impl throws and the other succeeds', () => {
    mockNative({
      nip44Decrypt: jest.fn(() => {
        throw new Error('native-only failure');
      }),
    });
    expect(() => nip44DecryptFrom(ciphertext, secretKey, counterpartyPubkeyHex)).toThrow(
      'native-only failure',
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('XCHECK MISMATCH op=nip44DecryptFrom'),
    );
  });

  it('verifies a native encrypt payload by JS round-trip decrypt', () => {
    // A well-behaved "native" impl: real nip44 with a fresh nonce, so the
    // payload differs from any JS payload but must decrypt identically.
    mockNative({
      nip44Encrypt: jest.fn(() => nip44.v2.encrypt(plaintext, conversationKey)),
    });
    nip44EncryptForRecipient(plaintext, secretKey, counterpartyPubkeyHex);
    expect(consoleError).not.toHaveBeenCalled();

    mockNative({ nip44Encrypt: jest.fn(() => 'garbage-payload') });
    nip44EncryptForRecipient(plaintext, secretKey, counterpartyPubkeyHex);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('XCHECK MISMATCH op=nip44EncryptForRecipient'),
    );
  });

  it('flags event-verify verdict divergence and returns the native verdict', () => {
    mockNative({ schnorrVerify: jest.fn(() => false) });
    const event = makeSignedEvent();
    expect(nostrVerifyEvent(event)).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('XCHECK MISMATCH op=nostrVerifyEvent'),
    );
  });
});
