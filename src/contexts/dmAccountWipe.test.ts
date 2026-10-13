import * as SecureStore from 'expo-secure-store';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

import { marmotCryptoProvider, MARMOT_CIPHERSUITE_ID } from '../services/marmotCryptoProvider';
import { getInstallationSignatureKeyPair } from '../services/marmotSignatureKey';
import { wipeDmStoresForAccount } from './dmAccountWipe';

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 5,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  File: class {
    exists = false;
  },
  Paths: { document: '/test' },
}));
jest.mock('../services/dmDb', () => ({ deleteDmMessagesForOwner: jest.fn() }));
jest.mock('./nostrDmCache', () => ({ wrapCacheFileName: () => 'test' }));
jest.mock('./dmStoreMigrationRunner', () => ({
  pendingDmStoreMigration: jest.fn(),
  forgetDmStoreMigration: jest.fn(),
}));
jest.mock('../services/marmotStore', () => ({ deleteMarmotStateForOwner: jest.fn() }));
jest.mock('../services/marmotDeletionStore', () => ({ forgetMarmotDeletionsForOwner: jest.fn() }));
jest.mock('../services/marmotSession', () => ({ quiesceMarmotSession: jest.fn() }));
jest.mock('../services/marmotPushRegistration', () => ({
  retireMarmotPushForAccount: jest.fn().mockResolvedValue(true),
}));

it('account sign-out removes only that account’s persisted leaf signing key', async () => {
  const stored = new Map<string, string>();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => stored.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {
    stored.set(key, value);
  });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    stored.delete(key);
  });
  const owner = getPublicKey(generateSecretKey());
  const other = getPublicKey(generateSecretKey());
  const slot = 'a'.repeat(64);
  const suite = await marmotCryptoProvider.getCiphersuiteImpl(MARMOT_CIPHERSUITE_ID);
  await getInstallationSignatureKeyPair(owner, slot, suite);
  await getInstallationSignatureKeyPair(other, slot, suite);
  await wipeDmStoresForAccount(owner);
  expect([...stored.keys()].some((key) => key.includes(owner))).toBe(false);
  expect(stored.has(`marmot_signature_key_${other}_${slot}`)).toBe(true);
});
