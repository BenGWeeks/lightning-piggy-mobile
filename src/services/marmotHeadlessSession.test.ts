const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
}));
const mockStart = jest.fn(async () => undefined);
let mockActive: { pubkey: string } | null = null;
const mockCtor = jest.fn();
jest.mock('./marmotSession', () => ({
  getMarmotSession: () => mockActive,
  setMarmotSession: (s: { pubkey: string } | null) => {
    mockActive = s;
  },
  MarmotSession: jest.fn().mockImplementation((opts: { pubkey: string }) => {
    mockCtor(opts);
    return { pubkey: opts.pubkey, start: mockStart };
  }),
}));
jest.mock('./nostrService', () => ({ DEFAULT_RELAYS: ['wss://default'] }));

import { restoreMarmotSessionHeadless } from './marmotHeadlessSession';

const ME = 'a'.repeat(64);
beforeEach(() => {
  mockStore.clear();
  mockActive = null;
  jest.clearAllMocks();
});

it("starts the active account's session when none is running", async () => {
  mockStore.set('nostr_pubkey', ME);
  mockStore.set('nostr_signer_type', 'amber');
  const s = await restoreMarmotSessionHeadless(ME, ['wss://mine']);
  expect(s?.pubkey).toBe(ME);
  expect(mockCtor.mock.calls[0][0]).toMatchObject({ pubkey: ME, signerType: 'amber' });
  expect(mockCtor.mock.calls[0][0].getWriteRelays()).toEqual(['wss://mine']);
  expect(mockStart).toHaveBeenCalled();
  expect(mockActive).toBe(s);
});

it('reuses a running session for the same account, never another account', async () => {
  mockActive = { pubkey: ME };
  expect(await restoreMarmotSessionHeadless(ME, [])).toBe(mockActive);
  mockActive = { pubkey: 'b'.repeat(64) };
  expect(await restoreMarmotSessionHeadless(ME, [])).toBeNull();
  expect(mockCtor).not.toHaveBeenCalled();
});

it('refuses when the share owner is no longer the active account', async () => {
  mockStore.set('nostr_pubkey', 'b'.repeat(64));
  mockStore.set('nostr_signer_type', 'nsec');
  expect(await restoreMarmotSessionHeadless(ME, [])).toBeNull();
  mockStore.set('nostr_pubkey', ME);
  mockStore.set('nostr_signer_type', 'bogus');
  expect(await restoreMarmotSessionHeadless(ME, [])).toBeNull();
  expect(mockCtor).not.toHaveBeenCalled();
});
