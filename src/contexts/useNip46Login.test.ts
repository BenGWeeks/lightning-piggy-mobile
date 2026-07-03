/**
 * Unit tests for restoreNip46Session — the cold-start NIP-46 session restore.
 * SecureStore, the connect service, and the two post-login side-effect services
 * are mocked so we exercise only the read → parse → re-assert → return logic.
 */
import { restoreNip46Session } from './useNip46Login';

const mockGetItemAsync = jest.fn();
const mockSetActiveConnection = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...a: unknown[]) => mockGetItemAsync(...(a as [])),
  setItemAsync: jest.fn(),
}));
jest.mock('../services/nostrConnectService', () => ({
  setActiveConnection: (...a: unknown[]) => mockSetActiveConnection(...(a as [])),
}));
jest.mock('../services/migrateToPerAccountStorage', () => ({
  migrateToPerAccountStorage: jest.fn(),
}));
jest.mock('../services/backgroundDmService', () => ({
  syncBackgroundDmWatchFromPreference: jest.fn(),
}));

const connection = {
  remoteSignerPubkey: 'bunker',
  userPubkey: 'user',
  relays: ['wss://r'],
  clientSecretKeyHex: 'aa',
  perms: 'sign_event',
};

beforeEach(() => jest.clearAllMocks());

it('restores the connection and returns the stored pubkey', async () => {
  mockGetItemAsync
    .mockResolvedValueOnce('user') // PUBKEY_KEY
    .mockResolvedValueOnce(JSON.stringify(connection)); // NIP46_CONNECTION_KEY
  await expect(restoreNip46Session()).resolves.toBe('user');
  expect(mockSetActiveConnection).toHaveBeenCalledWith(connection);
});

it('returns null when the stored pubkey is missing', async () => {
  mockGetItemAsync.mockResolvedValueOnce(null).mockResolvedValueOnce('{}');
  await expect(restoreNip46Session()).resolves.toBeNull();
  expect(mockSetActiveConnection).not.toHaveBeenCalled();
});

it('returns null when the connection blob is missing', async () => {
  mockGetItemAsync.mockResolvedValueOnce('user').mockResolvedValueOnce(null);
  await expect(restoreNip46Session()).resolves.toBeNull();
});

it('returns null (and does not throw) when the stored blob is corrupt', async () => {
  mockGetItemAsync.mockResolvedValueOnce('user').mockResolvedValueOnce('{not json');
  await expect(restoreNip46Session()).resolves.toBeNull();
  expect(mockSetActiveConnection).not.toHaveBeenCalled();
});
