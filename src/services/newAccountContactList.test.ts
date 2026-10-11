import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CREATED_HERE_TTL_MS,
  __resetForTests,
  clearAccountCreatedHere,
  isAccountCreatedHere,
  markAccountCreatedHere,
  setUpNewAccountContactList,
} from './newAccountContactList';

jest.mock('./nostrService', () => ({
  createContactListEvent: jest.requireActual('./nostrService').createContactListEvent,
  signAndPublishEvent: jest.fn(),
}));

const PK = 'a'.repeat(64);
const SK = new Uint8Array(32).fill(1);

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetForTests();
  jest.restoreAllMocks();
});

describe('newAccountContactList (#1271)', () => {
  it('publishes exactly one empty kind-3 for a new account, then clears the flag', async () => {
    const publish = jest.fn(async () => undefined);
    await expect(
      setUpNewAccountContactList({ pubkey: PK, secretKey: SK, relays: ['wss://r'], publish }),
    ).resolves.toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    const [event, secretKey, relays] = publish.mock.calls[0] as unknown as [
      { kind: number; tags: string[][]; content: string },
      Uint8Array,
      string[],
    ];
    expect(event.kind).toBe(3);
    expect(event.tags.filter((t) => t[0] === 'p')).toEqual([]);
    expect(event.content).toBe('');
    expect(secretKey).toBe(SK);
    expect(relays).toEqual(['wss://r']);
    // A list now exists on the relays: the account no longer needs the empty-list path.
    expect(await isAccountCreatedHere(PK)).toBe(false);
  });

  it('keeps the created-here flag when the initial publish fails', async () => {
    const publish = jest.fn(async () => {
      throw new Error('all relays rejected');
    });
    await expect(
      setUpNewAccountContactList({ pubkey: PK, secretKey: SK, relays: ['wss://r'], publish }),
    ).resolves.toBe(false);
    expect(await isAccountCreatedHere(PK)).toBe(true);
  });

  it('the flag is per account and case-insensitive', async () => {
    await markAccountCreatedHere(PK.toUpperCase());
    expect(await isAccountCreatedHere(PK)).toBe(true);
    expect(await isAccountCreatedHere('b'.repeat(64))).toBe(false);
    await clearAccountCreatedHere(PK);
    expect(await isAccountCreatedHere(PK)).toBe(false);
  });

  it('revocation survives a failed delete and a restart', async () => {
    await markAccountCreatedHere(PK);
    jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('disk full'));
    await clearAccountCreatedHere(PK);
    expect(await isAccountCreatedHere(PK)).toBe(false);
    __resetForTests(); // app restart: in-memory revocations gone
    expect(await isAccountCreatedHere(PK)).toBe(false);
  });

  it('expires on its own after the onboarding window', async () => {
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    await markAccountCreatedHere(PK);
    expect(await isAccountCreatedHere(PK)).toBe(true);
    spy.mockReturnValue(now + CREATED_HERE_TTL_MS + 1);
    expect(await isAccountCreatedHere(PK)).toBe(false);
  });

  it('if storage refuses every revocation, the in-memory one holds and the TTL bounds the rest', async () => {
    await markAccountCreatedHere(PK);
    jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValue(new Error('disk full'));
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'));
    await clearAccountCreatedHere(PK);
    expect(await isAccountCreatedHere(PK)).toBe(false);
  });
});
