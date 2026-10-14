import * as SecureStore from 'expo-secure-store';
import { nsecEncode } from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';
import { loadIdentities } from './identitiesStore';
import { initialiseBackgroundRelayAccount } from './backgroundRelayAccount';
import { getCurrentUserPubkey, setCurrentUserPubkey } from './nostrActiveAccount';
import { TEST_ACCOUNT_PUBKEYS } from '../config/testRelayLockdown';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn() }));
beforeEach(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
});
jest.mock('./identitiesStore', () => ({ loadIdentities: jest.fn() }));
afterEach(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
  setCurrentUserPubkey(null);
  jest.resetAllMocks();
});

it('restores a saved test account into a fresh headless mirror', async () => {
  const owner = [...TEST_ACCOUNT_PUBKEYS][0];
  setCurrentUserPubkey(null);
  jest.mocked(loadIdentities).mockResolvedValue({ activePubkey: owner, identities: [] });
  expect(await initialiseBackgroundRelayAccount()).toBe(owner);
  expect(getCurrentUserPubkey()).toBe(owner);
});

it.each([null, 'invalid'])(
  'returns unknown with an unavailable active identity (%s)',
  async (activePubkey) => {
    jest.mocked(loadIdentities).mockResolvedValue({ activePubkey, identities: [] });
    expect(await initialiseBackgroundRelayAccount()).toBeNull();
  },
);

it('returns unknown on storage errors', async () => {
  jest.mocked(loadIdentities).mockRejectedValue(new Error('storage locked'));
  expect(await initialiseBackgroundRelayAccount()).toBeNull();
});

it('returns a foreground account switch that happens while loading', async () => {
  const owner = [...TEST_ACCOUNT_PUBKEYS][0];
  setCurrentUserPubkey(null);
  jest.mocked(loadIdentities).mockImplementation(async () => {
    setCurrentUserPubkey('a'.repeat(64));
    return { activePubkey: owner, identities: [] };
  });
  expect(await initialiseBackgroundRelayAccount()).toBe('a'.repeat(64));
  expect(getCurrentUserPubkey()).toBe('a'.repeat(64));
});

const connection = (userPubkey: string) => ({
  userPubkey,
  remoteSignerPubkey: 'b'.repeat(64),
  clientSecretKeyHex: 'c'.repeat(64),
  perms: '',
  relays: ['wss://signer.example'],
});

it.each([null, 'd'.repeat(64)])(
  'resolves NIP-46 over an empty or stale registry (%s)',
  async (activePubkey) => {
    const owner = [...TEST_ACCOUNT_PUBKEYS][0];
    jest.mocked(loadIdentities).mockResolvedValue({ activePubkey, identities: [] });
    jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
      if (key === 'nostr_signer_type') return 'nip46';
      if (key === 'nostr_nip46_connection') return JSON.stringify(connection(owner));
      if (key === 'nostr_pubkey') return 'e'.repeat(64);
      return null;
    });
    expect(await initialiseBackgroundRelayAccount()).toBe(owner);
    expect(getCurrentUserPubkey()).toBe(owner);
    expect(loadIdentities).not.toHaveBeenCalled();
  },
);

it('preserves an already live foreground identity without storage access', async () => {
  const owner = 'a'.repeat(64);
  setCurrentUserPubkey(owner);
  expect(await initialiseBackgroundRelayAccount()).toBe(owner);
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  expect(loadIdentities).not.toHaveBeenCalled();
});

it.each(['nsec', 'amber'])('reads the foreground %s keys before the registry', async (signer) => {
  const key = new Uint8Array(32).fill(1);
  const owner = getPublicKey(key);
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (slot) => {
    if (slot === 'nostr_signer_type') return signer;
    if (slot === 'nostr_pubkey') return owner;
    if (slot === 'nostr_nsec') return nsecEncode(key);
    return null;
  });
  expect(await initialiseBackgroundRelayAccount()).toBe(owner);
  expect(loadIdentities).not.toHaveBeenCalled();
});

it('does nothing in release, even with an empty mirror', async () => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  expect(await initialiseBackgroundRelayAccount()).toBeNull();
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  expect(loadIdentities).not.toHaveBeenCalled();
  expect(getCurrentUserPubkey()).toBeNull();
});

it.each([null, '{}', '{broken'])(
  'does not fall back to a stale registry for an invalid NIP-46 session (%s)',
  async (raw) => {
    jest
      .mocked(SecureStore.getItemAsync)
      .mockImplementation(async (key) => (key === 'nostr_signer_type' ? 'nip46' : raw));
    expect(await initialiseBackgroundRelayAccount()).toBeNull();
    expect(loadIdentities).not.toHaveBeenCalled();
  },
);
