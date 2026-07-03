/**
 * Unit tests for the NIP-46 ("Nostr Connect") signer service. The nostr-tools
 * BunkerSigner + URI builder and the noble hex helper are mocked so we can
 * exercise the transport wrapper (connection lifecycle, event-template shaping,
 * permission-error normalisation) without a live relay/bunker.
 */
import type { Nip46Connection } from '../types/nostr';

const mockSigner = {
  connect: jest.fn(),
  getPublicKey: jest.fn(),
  signEvent: jest.fn(),
  nip04Encrypt: jest.fn(),
  nip04Decrypt: jest.fn(),
  nip44Encrypt: jest.fn(),
  nip44Decrypt: jest.fn(),
  close: jest.fn(),
  bp: { pubkey: 'bunkerpubkeyhex' },
};

const mockFromBunker = jest.fn(() => mockSigner);
const mockFromURI = jest.fn(async () => mockSigner);
const mockCreateNostrConnectURI = jest.fn(() => 'nostrconnect://mock-uri');

// Lazy wrappers so the references resolve at call-time — the mock factory is
// hoisted above the `const mock*` initialisers, so capturing them eagerly would
// snapshot `undefined`.
jest.mock('nostr-tools/nip46', () => ({
  BunkerSigner: {
    fromBunker: (...args: unknown[]) => mockFromBunker(...(args as [])),
    fromURI: (...args: unknown[]) => mockFromURI(...(args as [])),
  },
  createNostrConnectURI: (...args: unknown[]) => mockCreateNostrConnectURI(...(args as [])),
}));

jest.mock('@noble/hashes/utils.js', () => ({
  hexToBytes: jest.fn(() => new Uint8Array([1, 2, 3, 4])),
}));

import * as svc from './nostrConnectService';

const conn = (over: Partial<Nip46Connection> = {}): Nip46Connection => ({
  remoteSignerPubkey: 'bunkerpubkeyhex',
  userPubkey: 'userpubkeyhex',
  relays: ['wss://relay.example'],
  clientSecretKeyHex: 'aa'.repeat(32),
  perms: 'sign_event,nip44_decrypt',
  ...over,
});

beforeEach(async () => {
  // Tear down any signer a prior test left on the module singleton BEFORE
  // zeroing call counts, so its close() isn't attributed to the next test.
  mockSigner.close.mockResolvedValue(undefined);
  await svc.setActiveConnection(null);
  jest.clearAllMocks();
  mockSigner.connect.mockResolvedValue(undefined);
  mockSigner.getPublicKey.mockResolvedValue('userpubkeyhex');
  mockSigner.signEvent.mockResolvedValue({
    id: 'eventid',
    pubkey: 'userpubkeyhex',
    sig: 'sig123',
    kind: 1,
    created_at: 111,
    tags: [],
    content: 'hi',
  });
  mockSigner.nip04Encrypt.mockResolvedValue('nip04-ct');
  mockSigner.nip04Decrypt.mockResolvedValue('nip04-pt');
  mockSigner.nip44Encrypt.mockResolvedValue('nip44-ct');
  mockSigner.nip44Decrypt.mockResolvedValue('nip44-pt');
  mockSigner.close.mockResolvedValue(undefined);
  // Reset the module singleton to a clean, disconnected state.
  await svc.setActiveConnection(null);
});

describe('buildPairingUri', () => {
  it('delegates to mockCreateNostrConnectURI with a single-relay array', () => {
    const uri = svc.buildPairingUri({
      clientPubkey: 'clientpub',
      relay: 'wss://relay.example',
      secret: 'deadbeef',
      perms: ['sign_event'],
      name: 'Lightning Piggy',
    });
    expect(uri).toBe('nostrconnect://mock-uri');
    expect(mockCreateNostrConnectURI).toHaveBeenCalledWith({
      clientPubkey: 'clientpub',
      relays: ['wss://relay.example'],
      secret: 'deadbeef',
      perms: ['sign_event'],
      name: 'Lightning Piggy',
    });
  });
});

describe('setActiveConnection / getActiveConnection', () => {
  it('stores the connection and returns it', async () => {
    const c = conn();
    await svc.setActiveConnection(c);
    expect(svc.getActiveConnection()).toBe(c);
  });

  it('is a no-op when the same connection fields are set again', async () => {
    await svc.setActiveConnection(conn());
    // Build a signer so we can observe that it is NOT torn down.
    await svc.requestPublicKey();
    expect(mockFromBunker).toHaveBeenCalledTimes(1);
    await svc.setActiveConnection(conn()); // identical fields
    expect(mockSigner.close).not.toHaveBeenCalled();
  });

  it('closes the previous signer when the connection changes', async () => {
    await svc.setActiveConnection(conn());
    await svc.requestPublicKey(); // constructs signer
    await svc.setActiveConnection(conn({ userPubkey: 'different' }));
    expect(mockSigner.close).toHaveBeenCalledTimes(1);
    expect(svc.getActiveConnection()).toEqual(conn({ userPubkey: 'different' }));
  });

  it('clears to null on logout', async () => {
    await svc.setActiveConnection(conn());
    await svc.setActiveConnection(null);
    expect(svc.getActiveConnection()).toBeNull();
  });
});

describe('getSigner (via requestPublicKey)', () => {
  it('throws when no connection is set', async () => {
    await expect(svc.requestPublicKey()).rejects.toThrow('NIP-46 signer not connected');
  });

  it('constructs + connects the signer once and caches it', async () => {
    await svc.setActiveConnection(conn());
    await svc.requestPublicKey();
    await svc.requestPublicKey();
    expect(mockFromBunker).toHaveBeenCalledTimes(1);
    expect(mockSigner.connect).toHaveBeenCalledTimes(1);
  });

  it('wraps a connect() failure in a clear error', async () => {
    mockSigner.connect.mockRejectedValueOnce(new Error('relay down'));
    await svc.setActiveConnection(conn());
    await expect(svc.requestPublicKey()).rejects.toThrow(
      'NIP-46 signer could not connect: relay down',
    );
  });
});

describe('requestEventSignature', () => {
  it('strips pubkey/id/sig into an EventTemplate and returns the signed JSON', async () => {
    await svc.setActiveConnection(conn());
    const eventJson = JSON.stringify({
      pubkey: 'shouldbestripped',
      id: 'shouldbestripped',
      sig: 'shouldbestripped',
      kind: 4,
      created_at: 222,
      tags: [['p', 'peer']],
      content: 'body',
    });
    const { signature, event } = await svc.requestEventSignature(eventJson, '', '');
    expect(mockSigner.signEvent).toHaveBeenCalledWith({
      kind: 4,
      created_at: 222,
      tags: [['p', 'peer']],
      content: 'body',
    });
    expect(signature).toBe('sig123');
    expect(JSON.parse(event).sig).toBe('sig123');
  });
});

describe('encrypt/decrypt delegation', () => {
  beforeEach(async () => {
    await svc.setActiveConnection(conn());
  });

  it('nip04 encrypt/decrypt call the signer with (peer, payload)', async () => {
    expect(await svc.requestNip04Encrypt('plain', 'peer', '')).toBe('nip04-ct');
    expect(mockSigner.nip04Encrypt).toHaveBeenCalledWith('peer', 'plain');
    expect(await svc.requestNip04Decrypt('ct', 'peer', '')).toBe('nip04-pt');
    expect(mockSigner.nip04Decrypt).toHaveBeenCalledWith('peer', 'ct');
  });

  it('nip44 encrypt/decrypt call the signer with (peer, payload)', async () => {
    expect(await svc.requestNip44Encrypt('plain', 'peer', '')).toBe('nip44-ct');
    expect(mockSigner.nip44Encrypt).toHaveBeenCalledWith('peer', 'plain');
    expect(await svc.requestNip44Decrypt('ct', 'peer', '')).toBe('nip44-pt');
    expect(mockSigner.nip44Decrypt).toHaveBeenCalledWith('peer', 'ct');
  });

  it('normalises a permission error into "NIP-46 signer denied <method>"', async () => {
    mockSigner.nip44Decrypt.mockRejectedValueOnce(new Error('user denied permission'));
    await expect(svc.requestNip44Decrypt('ct', 'peer', '')).rejects.toThrow(
      'NIP-46 signer denied nip44_decrypt',
    );
  });

  it('passes through a non-permission error unchanged', async () => {
    mockSigner.nip04Encrypt.mockRejectedValueOnce(new Error('network timeout'));
    await expect(svc.requestNip04Encrypt('p', 'peer', '')).rejects.toThrow('network timeout');
  });
});

describe('requestNip44DecryptSilent', () => {
  it('always throws — NIP-46 has no silent-batch path', async () => {
    await expect(svc.requestNip44DecryptSilent('ct', 'peer', '')).rejects.toThrow(
      'does not support silent batch decrypt',
    );
  });
});

describe('awaitBunkerPair', () => {
  it('builds the URI, resolves the user pubkey, and returns a persistable connection', async () => {
    const result = await svc.awaitBunkerPair({
      clientSecretKey: new Uint8Array([1, 2, 3, 4]),
      clientPubkey: 'clientpub',
      relay: 'wss://relay.example',
      secret: 'deadbeef',
      perms: ['sign_event', 'nip44_decrypt'],
      name: 'Lightning Piggy',
      maxWaitSeconds: 60,
    });
    expect(mockFromURI).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3, 4]),
      'nostrconnect://mock-uri',
      undefined,
      60_000,
    );
    expect(result.userPubkey).toBe('userpubkeyhex');
    expect(result.connection).toEqual({
      remoteSignerPubkey: 'bunkerpubkeyhex',
      userPubkey: 'userpubkeyhex',
      relays: ['wss://relay.example'],
      clientSecretKeyHex: '01020304',
      perms: 'sign_event,nip44_decrypt',
    });
    // The live signer is cached, so a follow-up call reuses it (no new build).
    await svc.requestPublicKey();
    expect(mockFromBunker).not.toHaveBeenCalled();
  });
});
