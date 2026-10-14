import { act, renderHook } from '@testing-library/react-native';
import { useListingShare } from './useListingShare';
import { preferredDmProtocol } from '../services/preferredDmProtocol';
import { Toast } from '../components/BrandedToast';
import type { MarketProduct } from '../data/marketProducts';

let mockMe = 'a'.repeat(64);
const FRIEND = 'b'.repeat(64);
const SELLER = 'c'.repeat(64);
const mockSend = jest.fn();
const mockAppend = jest.fn();

jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({
    pubkey: mockMe,
    sendDirectMessage: mockSend,
    appendLocalDmMessage: mockAppend,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockMe = 'a'.repeat(64);
  mockSend.mockResolvedValue({ success: true });
  mockAppend.mockResolvedValue(undefined);
});

it.each(['account', 'unmount'] as const)(
  'stops a pending protocol lookup after %s',
  async (change) => {
    const lookup = deferred<'nip17'>();
    jest.mocked(preferredDmProtocol).mockReturnValue(lookup.promise);
    const hook = renderHook(() => useListingShare(product));
    let send!: Promise<void>;
    act(() => {
      send = hook.result.current.sendToFriend({ pubkey: FRIEND, name: 'Friend' } as never);
    });
    if (change === 'account') {
      mockMe = 'd'.repeat(64);
      hook.rerender({});
      expect(hook.result.current.sending).toBe(false);
    } else hook.unmount();
    await act(async () => {
      lookup.resolve('nip17');
      await send;
    });
    expect(mockSend).not.toHaveBeenCalled();
    expect(Toast.show).not.toHaveBeenCalled();
  },
);

it.each(['account', 'unmount'] as const)(
  'does not append or toast a completed send after %s',
  async (change) => {
    const delivery = deferred<{ success: boolean }>();
    jest.mocked(preferredDmProtocol).mockResolvedValue('nip17');
    mockSend.mockReturnValue(delivery.promise);
    const hook = renderHook(() => useListingShare(product));
    let send!: Promise<void>;
    await act(async () => {
      send = hook.result.current.sendToFriend({ pubkey: FRIEND, name: 'Friend' } as never);
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    if (change === 'account') {
      mockMe = 'd'.repeat(64);
      hook.rerender({});
    } else hook.unmount();
    await act(async () => {
      delivery.resolve({ success: true });
      await send;
    });
    expect(mockAppend).not.toHaveBeenCalled();
    expect(Toast.show).not.toHaveBeenCalled();
  },
);

it('does not revive an old send when switching away and back to its account', async () => {
  const oldLookup = deferred<'nip17'>();
  const newLookup = deferred<'nip17'>();
  jest
    .mocked(preferredDmProtocol)
    .mockReturnValueOnce(oldLookup.promise)
    .mockReturnValueOnce(newLookup.promise);
  const hook = renderHook(() => useListingShare(product));
  let oldSend!: Promise<void>;
  act(() => {
    oldSend = hook.result.current.sendToFriend({ pubkey: FRIEND, name: 'Friend' } as never);
  });
  mockMe = 'd'.repeat(64);
  hook.rerender({});
  mockMe = 'a'.repeat(64);
  hook.rerender({});
  let newSend!: Promise<void>;
  act(() => {
    newSend = hook.result.current.sendToFriend({ pubkey: FRIEND, name: 'Friend' } as never);
  });
  await act(async () => {
    oldLookup.resolve('nip17');
    await oldSend;
  });
  expect(hook.result.current.sending).toBe(true);
  expect(mockSend).not.toHaveBeenCalled();
  await act(async () => {
    newLookup.resolve('nip17');
    await newSend;
  });
  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(hook.result.current.sending).toBe(false);
});
