import { act, renderHook } from '@testing-library/react-native';
import { useListingShare } from './useListingShare';
import { preferredDmProtocol } from '../services/preferredDmProtocol';
import type { MarketProduct } from '../data/marketProducts';

const mockMe = 'a'.repeat(64);
const FRIEND = 'b'.repeat(64);
const SELLER = 'c'.repeat(64);
const mockSend = jest.fn(async () => ({ success: true }));

jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({
    pubkey: mockMe,
    sendDirectMessage: mockSend,
    appendLocalDmMessage: jest.fn(),
  }),
}));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('../services/preferredDmProtocol', () => ({ preferredDmProtocol: jest.fn() }));

const product = {
  id: 'widget',
  title: 'Widget',
  listing: {
    event: {
      kind: 30402,
      pubkey: SELLER,
      tags: [['d', 'widget']],
      created_at: 1,
      id: 'e',
      content: '',
    },
  },
} as unknown as MarketProduct;

it.each(['marmot', 'nip17'] as const)(
  'sends to a friend over their preferred protocol (%s)',
  async (protocol) => {
    (preferredDmProtocol as jest.Mock).mockResolvedValue(protocol);
    const { result } = renderHook(() => useListingShare(product));
    await act(() => result.current.sendToFriend({ pubkey: FRIEND, name: 'Friend' } as never));
    expect(preferredDmProtocol).toHaveBeenCalledWith(mockMe, FRIEND);
    expect(mockSend).toHaveBeenLastCalledWith(FRIEND, expect.stringContaining('nostr:naddr1'), {
      protocol,
    });
  },
);
