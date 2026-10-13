import { renderHook, waitFor } from '@testing-library/react-native';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { usePubkeyProfile } from './usePubkeyProfile';
import { pool, __resetVerifiedEventCache } from '../services/nostrService';
import * as cache from '../services/zapSenderProfileStorage';

jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ relays: [{ url: 'wss://relay.example.com', read: true }] }),
}));
jest.mock('../services/nostrPool', () => ({
  pool: { get: jest.fn() },
  connectedRelays: new Set(),
  trackRelays: jest.fn(),
}));
jest.mock('../services/zapSenderProfileStorage', () => ({
  peekSync: jest.fn(),
  get: jest.fn(),
  setMany: jest.fn().mockResolvedValue(undefined),
}));

const secretKey = new Uint8Array(32).fill(1);
const pubkey = getPublicKey(secretKey);

beforeEach(() => {
  jest.clearAllMocks();
  __resetVerifiedEventCache();
  // Merchant batch entries intentionally omit unverified payment metadata.
  const merchant = {
    npub: npubEncode(pubkey),
    name: 'Cached shop',
    displayName: null,
    picture: null,
    nip05: null,
  };
  jest.mocked(cache.peekSync).mockReturnValue(merchant);
  jest.mocked(cache.get).mockResolvedValue(merchant);
});

it.each([
  [{ name: { text: 'Seller' } }, null],
  [{ name: 'Seller', display_name: { text: 'Shop' } }, 'Seller'],
  [{ name: {}, display_name: 'Shop', nip05: [] }, 'Shop'],
] as const)(
  'sanitizes signed relay fallback metadata %j after an incomplete merchant cache hit',
  async (metadata, expectedName) => {
    const event = finalizeEvent(
      {
        kind: 0,
        created_at: 1,
        tags: [],
        content: JSON.stringify({ ...metadata, lud16: 'seller@example.com' }),
      },
      secretKey,
    );
    jest.mocked(pool.get).mockResolvedValue(event);

    const { result } = renderHook(() => usePubkeyProfile(pubkey));
    expect(result.current.name).toBe('Cached shop');
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(pool.get).toHaveBeenCalledWith(expect.arrayContaining(['wss://relay.example.com']), {
      kinds: [0],
      authors: [pubkey],
    });
    expect(result.current).toMatchObject({
      name: expectedName,
      picture: null,
      lud16: 'seller@example.com',
    });
    // Same initial fallback used by VendorAvatar when there is no image.
    expect((result.current.name ?? 'Seller').charAt(0).toUpperCase()).toBe('S');
    expect(cache.setMany).toHaveBeenCalledTimes(1);
    const saved = jest.mocked(cache.setMany).mock.calls[0][0].get(pubkey)!;
    expect(saved.name).toBe(typeof metadata.name === 'string' ? metadata.name : null);
    expect(saved.nip05).toBeNull();
    expect(saved.lud16).toBe('seller@example.com');
  },
);
