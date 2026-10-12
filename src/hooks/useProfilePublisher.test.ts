import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { useProfilePublisher } from './useProfilePublisher';
import { queryQuorum, publishSellerEvent } from '../services/marketSellerService';
import { signAccountEvent } from '../services/signAccountEvent';
import { Toast } from '../components/BrandedToast';
import type { NostrProfile } from '../types/nostr';

jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('../services/signAccountEvent', () => ({ signAccountEvent: jest.fn() }));
jest.mock('../services/marketSellerService', () => ({
  queryQuorum: jest.fn(),
  verifiedOwnEvents: jest.fn(async (events) => events),
  publishSellerEvent: jest.fn(),
  sellerRelays: () => ['wss://write.example'],
}));
const secret = new Uint8Array(32).fill(90);
const pubkey = getPublicKey(secret);
const input = {
  pubkey,
  isLoggedIn: true,
  signerType: 'nsec' as const,
  relays: [
    { url: 'wss://write.example', read: false, write: true },
    { url: 'wss://read.example', read: true, write: false },
  ],
  profile: { pubkey, name: 'Known profile' } as NostrProfile,
  setProfile: jest.fn(),
  cacheKey: 'profile',
  timestampKey: 'profile-time',
};
beforeEach(() => {
  jest.clearAllMocks();
  (queryQuorum as jest.Mock).mockResolvedValue([]);
  (publishSellerEvent as jest.Mock).mockResolvedValue(undefined);
  (signAccountEvent as jest.Mock).mockImplementation(async (template) =>
    finalizeEvent(template, secret),
  );
});
it('uses cached/display profile only as existence evidence and reports failed recovery', async () => {
  const { result } = renderHook(() => useProfilePublisher(input));
  await act(async () => {
    expect(await result.current({ about: 'New bio' })).toBe(false);
  });
  expect(signAccountEvent).not.toHaveBeenCalled();
  expect(publishSellerEvent).not.toHaveBeenCalled();
  expect(input.setProfile).not.toHaveBeenCalled();
  expect(Toast.show).toHaveBeenCalledWith({
    type: 'error',
    text1: 'editProfileSheet.profileUnavailable',
  });
});
it('passes NIP-65 read and write relays to profile recovery', async () => {
  const { result } = renderHook(() => useProfilePublisher(input));
  await act(async () => {
    await result.current({});
  });
  expect((queryQuorum as jest.Mock).mock.calls[0][0]).toEqual(
    expect.arrayContaining(['wss://write.example', 'wss://read.example']),
  );
});
it('surfaces missing-profile errors to callers that own the alert', async () => {
  const { result } = renderHook(() => useProfilePublisher(input));
  await act(async () => {
    await expect(result.current({}, { force: true })).rejects.toThrow();
  });
  expect(Toast.show).not.toHaveBeenCalled();
  expect(signAccountEvent).not.toHaveBeenCalled();
});

it('refuses lost relay data even before the cached display profile has hydrated', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify(input.profile));
  const { result } = renderHook(() => useProfilePublisher({ ...input, profile: null }));
  await act(async () => {
    expect(await result.current({ about: 'New bio' })).toBe(false);
  });
  expect(signAccountEvent).not.toHaveBeenCalled();
  expect(publishSellerEvent).not.toHaveBeenCalled();
  expect(Toast.show).toHaveBeenCalledWith({
    type: 'error',
    text1: 'editProfileSheet.profileUnavailable',
  });
});
