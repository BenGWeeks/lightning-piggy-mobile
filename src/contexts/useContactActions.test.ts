import { act, renderHook } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nostrService from '../services/nostrService';
import { Toast } from '../components/BrandedToast';
import type { ContactListFetchResult } from '../services/contactListSync';
import type { NostrContact, RelayConfig } from '../types/nostr';
import { useContactActions } from './useContactActions';
import {
  __resetForTests,
  isAccountCreatedHere,
  markAccountCreatedHere,
} from '../services/newAccountContactList';

const ME = 'a'.repeat(64);
const BIG = 'b'.repeat(64);
const LITTLE = 'c'.repeat(64);
const NEW = 'd'.repeat(64);

jest.mock('../services/nostrService', () => ({
  DEFAULT_RELAYS: ['wss://default'],
  decodeNsec: jest.fn(() => ({ pubkey: 'a'.repeat(64), secretKey: new Uint8Array(32) })),
  signAndPublishEvent: jest.fn(async () => undefined),
  publishSignedEvent: jest.fn(async () => undefined),
  fetchProfile: jest.fn(async () => null),
}));
jest.mock('../components/BrandedToast', () => ({ Toast: { show: jest.fn() } }));

const mockFetch = jest.fn<Promise<ContactListFetchResult>, [string, string[]]>();
jest.mock('../services/contactListSync', () => {
  const actual = jest.requireActual('../services/contactListSync');
  return {
    ...actual,
    prepareContactListUpdate: (args: object) =>
      actual.prepareContactListUpdate({ ...args, fetchLatest: mockFetch }),
  };
});

const relays: RelayConfig[] = [{ url: 'wss://mine', read: true, write: true }];

function setup(contacts: NostrContact[]) {
  const setContacts = jest.fn();
  const { result } = renderHook(() =>
    useContactActions({
      pubkey: ME,
      isLoggedIn: true,
      signerType: 'nsec',
      relays,
      contacts,
      setContacts,
      getReadRelays: () => ['wss://mine'],
      loadContacts: jest.fn(async () => {}),
    }),
  );
  return { result, setContacts };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  __resetForTests();
  jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue('nsec1test');
});

describe('useContactActions follow path (#1271)', () => {
  it('follows on top of the relay list when the local list never loaded', async () => {
    mockFetch.mockResolvedValue({
      status: 'found',
      base: {
        tags: [
          ['p', BIG],
          ['p', LITTLE],
        ],
        content: '{"wss://x":{}}',
        createdAt: 10,
      },
    });
    const { result } = setup([]);
    let ok = false;
    await act(async () => {
      ok = await result.current.followContact(NEW);
    });
    expect(ok).toBe(true);
    const published = (nostrService.signAndPublishEvent as jest.Mock).mock.calls[0][0];
    expect(published.tags.filter((t: string[]) => t[0] === 'p').map((t: string[]) => t[1])).toEqual(
      [BIG, LITTLE, NEW],
    );
    expect(published.content).toBe('{"wss://x":{}}');
  });

  it('does not publish (and shows a branded error) when the fetch fails and the local list is empty', async () => {
    mockFetch.mockResolvedValue({ status: 'failed' });
    const { result, setContacts } = setup([]);
    let ok = true;
    await act(async () => {
      ok = await result.current.followContact(NEW);
    });
    expect(ok).toBe(false);
    expect(nostrService.signAndPublishEvent).not.toHaveBeenCalled();
    expect(setContacts).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('does not publish when relays only report EOSE (no kind-3) and the local list is empty', async () => {
    mockFetch.mockResolvedValue({ status: 'empty', confirmedBy: 2 });
    const { result } = setup([]);
    let ok = true;
    await act(async () => {
      ok = await result.current.followContact(NEW);
    });
    expect(ok).toBe(false);
    expect(nostrService.signAndPublishEvent).not.toHaveBeenCalled();
  });

  it('does not publish when the fetch fails, even with a non-empty local list', async () => {
    mockFetch.mockResolvedValue({ status: 'failed' });
    const local: NostrContact = { pubkey: BIG, relay: null, petname: null, profile: null };
    const { result } = setup([local]);
    let ok = true;
    await act(async () => {
      ok = await result.current.followContact(NEW);
    });
    expect(ok).toBe(false);
    expect(nostrService.signAndPublishEvent).not.toHaveBeenCalled();
  });

  it('serialises overlapping follows so the second keeps the first', async () => {
    const OTHER = 'e'.repeat(64);
    // Relays keep serving the pre-follow list (lag after our first publish).
    mockFetch.mockResolvedValue({
      status: 'found',
      base: { tags: [['p', BIG]], content: '', createdAt: 10 },
    });
    const { result } = setup([]);
    await act(async () => {
      await Promise.all([result.current.followContact(NEW), result.current.followContact(OTHER)]);
    });
    const calls = (nostrService.signAndPublishEvent as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    const last = calls[1][0].tags.filter((t: string[]) => t[0] === 'p').map((t: string[]) => t[1]);
    expect(last).toEqual([BIG, NEW, OTHER]);
  });

  it('account created here: relays confirm no list → first follow publishes [new] and clears the flag', async () => {
    await markAccountCreatedHere(ME);
    mockFetch.mockResolvedValue({ status: 'empty', confirmedBy: 2 });
    const { result } = setup([]);
    let ok = false;
    await act(async () => {
      ok = await result.current.followContact(NEW);
    });
    expect(ok).toBe(true);
    const published = (nostrService.signAndPublishEvent as jest.Mock).mock.calls[0][0];
    expect(published.tags.filter((t: string[]) => t[0] === 'p').map((t: string[]) => t[1])).toEqual(
      [NEW],
    );
    expect(await isAccountCreatedHere(ME)).toBe(false);
  });

  it('imported account: relays answering empty → refuse, nothing published', async () => {
    mockFetch.mockResolvedValue({ status: 'empty', confirmedBy: 3 });
    const { result } = setup([]);
    let ok = true;
    await act(async () => {
      ok = await result.current.followContact(NEW);
    });
    expect(ok).toBe(false);
    expect(nostrService.signAndPublishEvent).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('clears the created-here flag once a relay list has been seen', async () => {
    await markAccountCreatedHere(ME);
    mockFetch.mockResolvedValue({
      status: 'found',
      base: { tags: [['p', BIG]], content: '', createdAt: 10 },
    });
    const { result } = setup([]);
    await act(async () => {
      await result.current.followContact(BIG); // already in the list: no publish
    });
    expect(nostrService.signAndPublishEvent).not.toHaveBeenCalled();
    expect(await isAccountCreatedHere(ME)).toBe(false);
  });

  it('an unverifiable list revokes the created-here flag, so a later empty answer refuses', async () => {
    await markAccountCreatedHere(ME);
    mockFetch.mockResolvedValueOnce({ status: 'failed', sawList: true });
    mockFetch.mockResolvedValueOnce({ status: 'empty', confirmedBy: 3 });
    const { result } = setup([]);
    let first = true;
    let second = true;
    await act(async () => {
      first = await result.current.followContact(NEW);
    });
    await act(async () => {
      second = await result.current.followContact(NEW);
    });
    expect([first, second]).toEqual([false, false]);
    expect(nostrService.signAndPublishEvent).not.toHaveBeenCalled();
    expect(await isAccountCreatedHere(ME)).toBe(false);
  });

  it('unfollow removes only that person from the relay list', async () => {
    mockFetch.mockResolvedValue({
      status: 'found',
      base: {
        tags: [
          ['p', BIG],
          ['p', LITTLE],
        ],
        content: '',
        createdAt: 10,
      },
    });
    const { result } = setup([]);
    await act(async () => {
      await result.current.unfollowContact(BIG);
    });
    const published = (nostrService.signAndPublishEvent as jest.Mock).mock.calls[0][0];
    expect(published.tags.filter((t: string[]) => t[0] === 'p').map((t: string[]) => t[1])).toEqual(
      [LITTLE],
    );
  });
});
