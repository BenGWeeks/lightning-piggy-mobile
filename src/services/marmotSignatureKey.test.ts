import {
  createCredential,
  createKeyPackageEvent,
  generateKeyPackage,
} from '@internet-privacy/marmot-ts';
import { nodeTypes } from '@internet-privacy/marmot-ts/mls';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as SecureStore from 'expo-secure-store';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type Event as NostrEvent,
} from 'nostr-tools';

import { marmotCryptoProvider, MARMOT_CIPHERSUITE_ID } from './marmotCryptoProvider';
import { MarmotDeviceTracker, type TrackedGroup } from './marmotDeviceTracker';
import { keyPackageSignatureKey } from './marmotDevices';
import {
  deleteInstallationSignatureKey,
  getInstallationSignatureKeyPair,
} from './marmotSignatureKey';
import { createMemoryMarmotBackend } from './marmotStore';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 5,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const stored = new Map<string, string>();
const accountSecret = generateSecretKey();
const owner = getPublicKey(accountSecret);
const other = getPublicKey(generateSecretKey());
const slot = 'a'.repeat(64);
const secondSlot = 'b'.repeat(64);
const signer = {
  getPublicKey: async () => owner,
  signEvent: async (event: Parameters<typeof finalizeEvent>[0]) =>
    finalizeEvent(event, accountSecret),
};
const suite = () => marmotCryptoProvider.getCiphersuiteImpl(MARMOT_CIPHERSUITE_ID);

beforeEach(() => {
  stored.clear();
  jest.clearAllMocks();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => stored.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    stored.set(key, value);
  });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    stored.delete(key);
  });
});

async function keyPackage() {
  const ciphersuiteImpl = await suite();
  return generateKeyPackage({
    credential: createCredential(owner),
    signer,
    ciphersuiteImpl,
    signatureKeyPair: await getInstallationSignatureKeyPair(owner, slot, ciphersuiteImpl),
  });
}

it('persists one signing key across two KeyPackages with distinct init keys', async () => {
  const first = await keyPackage();
  const second = await keyPackage();
  expect(first.publicPackage.leafNode.signaturePublicKey).toEqual(
    second.publicPackage.leafNode.signaturePublicKey,
  );
  expect(first.publicPackage.initKey).not.toEqual(second.publicPackage.initKey);
  expect(
    jest
      .mocked(SecureStore.setItemAsync)
      .mock.calls.every(
        (call) => call[2]?.keychainAccessible === SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      ),
  ).toBe(true);
});

it('separates accounts and slots, deleting the old slot key on reset', async () => {
  const ciphersuite = await suite();
  const first = await getInstallationSignatureKeyPair(owner, slot, ciphersuite);
  const another = await getInstallationSignatureKeyPair(other, slot, ciphersuite);
  const reset = await getInstallationSignatureKeyPair(owner, secondSlot, ciphersuite);
  expect(bytesToHex(first.publicKey)).not.toBe(bytesToHex(another.publicKey));
  expect(bytesToHex(first.publicKey)).not.toBe(bytesToHex(reset.publicKey));
  expect(stored.has(`marmot_signature_key_${owner}_${slot}`)).toBe(false);
  expect(stored.has(`marmot_signature_key_${other}_${slot}`)).toBe(true);
});

it('serializes concurrent first use and removes the secret on account sign-out', async () => {
  const ciphersuite = await suite();
  const get = () => getInstallationSignatureKeyPair(owner, slot, ciphersuite);
  const [first, second] = await Promise.all([get(), get()]);
  expect(first.publicKey).toEqual(second.publicKey);
  // Sign-out while a read/create is still queued must leave no late secret.
  await Promise.all([get(), deleteInstallationSignatureKey(owner)]);
  expect([...stored.keys()].some((key) => key.includes(owner))).toBe(false);
  const after = await get();
  expect(after.publicKey).not.toEqual(first.publicKey);
});

it('resolves a joined leaf from the newer advertisement after its KeyPackage is consumed', async () => {
  const joined = await keyPackage();
  const newer = await keyPackage();
  const template = await createKeyPackageEvent({
    keyPackage: newer.publicPackage,
    identifier: slot,
    relays: ['wss://relay.example'],
    client: 'Lightning Piggy',
  });
  const event = (await signer.signEvent(template)) as NostrEvent;
  expect(keyPackageSignatureKey(event)).toBe(
    bytesToHex(joined.publicPackage.leafNode.signaturePublicKey),
  );
  // Only the replacement is on the relay: the joined package was deleted.
  const group = {
    idStr: 'test-group',
    state: {
      ratchetTree: [{ nodeType: nodeTypes.leaf, leaf: joined.publicPackage.leafNode }],
      groupContext: { epoch: 1n },
      privatePath: { leafIndex: 1 },
    },
  } as unknown as TrackedGroup;
  const tracker = new MarmotDeviceTracker({
    backend: createMemoryMarmotBackend(),
    groups: () => [group],
    ownClient: 'Other app',
    fetchKeyPackages: async () => [event],
  });
  await tracker.observe(group);
  await tracker.resolveClients(group.idStr);
  const view = await tracker.devices(group.idStr);
  expect(view?.people.get(owner)?.[0].client).toBe('Lightning Piggy');
});
