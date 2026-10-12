import { DEFAULT_RELAYS, PROFILE_RELAYS } from './nostrRelayDefaults';
import { finalizeEvent, getPublicKey, verifyEvent, type Event } from 'nostr-tools';
import {
  fetchMerchantProfile,
  publishMergedProfile,
  profileReadRelays,
} from './merchantProfileService';
import { queryQuorum, verifiedOwnEvents, publishSellerEvent } from './marketSellerService';
import { SellerFetchError, StaleRevisionError } from '../utils/marketSellerRevision';
jest.mock('./marketSellerService', () => ({
  queryQuorum: jest.fn(),
  verifiedOwnEvents: jest.fn(),
  publishSellerEvent: jest.fn(),
}));
let key = new Uint8Array(32).fill(8);
let fixtureKey = 40;
let pubkey = getPublicKey(key);
const sign = jest.fn(async (t) => finalizeEvent(t, key));
const profile = (at: number, custom: unknown = 'original') =>
  finalizeEvent(
    {
      kind: 0,
      created_at: at,
      content: JSON.stringify({ name: 'Seller', lud16: 'pay@example.com', custom }),
      tags: [
        ['client', 'foreign'],
        ['payment_preference', 'manual'],
      ],
    },
    key,
  );
let base = profile(100);
let latest = profile(200, { latest: true });
beforeEach(() => {
  jest.clearAllMocks();
  key = new Uint8Array(32).fill(fixtureKey++);
  pubkey = getPublicKey(key);
  base = profile(100);
  latest = profile(200, { latest: true });
  (queryQuorum as jest.Mock).mockResolvedValue([latest]);
  (verifiedOwnEvents as jest.Mock).mockImplementation(
    async (events: Event[], author: string, kinds: number[]) =>
      events.filter((e) => e.pubkey === author && kinds.includes(e.kind) && verifyEvent(e)),
  );
  (publishSellerEvent as jest.Mock).mockResolvedValue(undefined);
});
it('re-fetches bounded kind 0 and publishes a merge of the latest content through the profile path', async () => {
  const result = await publishMergedProfile({
    pubkey,
    relays: ['wss://example.com'],
    patch: {},
    options: { paymentPreference: 'ecash', base, force: true },
    sign,
    isCurrent: () => true,
  });
  expect(queryQuorum).toHaveBeenCalledWith(
    profileReadRelays(['wss://example.com']),
    { kinds: [0], authors: [pubkey], limit: 5 },
    undefined,
  );
  expect(JSON.parse(result.content)).toEqual(JSON.parse(latest.content));
  expect(result.tags).toEqual([
    ['client', 'foreign'],
    ['payment_preference', 'ecash'],
  ]);
  expect(publishSellerEvent).toHaveBeenCalledWith(result, ['wss://example.com']);
});
it('requires confirmation before overwriting a different kind-0 revision', async () => {
  await expect(
    publishMergedProfile({
      pubkey,
      relays: [],
      patch: {},
      options: { paymentPreference: 'lud16', base },
      sign,
      isCurrent: () => true,
    }),
  ).rejects.toBeInstanceOf(StaleRevisionError);
  expect(sign).not.toHaveBeenCalled();
  expect(publishSellerEvent).not.toHaveBeenCalled();
});
it('does not publish after a failed latest-profile query', async () => {
  (queryQuorum as jest.Mock).mockRejectedValue(new Error('Offline'));
  await expect(
    publishMergedProfile({ pubkey, relays: [], patch: {}, sign, isCurrent: () => true }),
  ).rejects.toBeInstanceOf(SellerFetchError);
  expect(sign).not.toHaveBeenCalled();
});
it('rejects an account switch while the latest profile is being fetched', async () => {
  await expect(
    publishMergedProfile({ pubkey, relays: [], patch: {}, sign, isCurrent: () => false }),
  ).rejects.toThrow('account changed');
  expect(sign).not.toHaveBeenCalled();
});
it('rejects a signer that changes a preserved field', async () => {
  await expect(
    publishMergedProfile({
      pubkey,
      relays: [],
      patch: {},
      sign: async (template) => finalizeEvent({ ...template, content: '{}' }, key),
      isCurrent: () => true,
    }),
  ).rejects.toThrow('unexpected event');
  expect(publishSellerEvent).not.toHaveBeenCalled();
});
it('selects the verified latest profile with the NIP-01 tie break', async () => {
  const tied = profile(200, 'tied');
  const expected = [latest, tied].sort((a, b) => a.id.localeCompare(b.id))[0];
  (queryQuorum as jest.Mock).mockResolvedValue([
    base,
    latest,
    tied,
    { ...latest, pubkey: 'b'.repeat(64) },
  ]);
  expect(await fetchMerchantProfile(pubkey, [])).toEqual(expected);
});

it('reads indexers, defaults, and bounded user read/write relays', async () => {
  await fetchMerchantProfile(pubkey, ['wss://write.example', 'wss://read.example']);
  const relays = (queryQuorum as jest.Mock).mock.calls[0][0];
  expect(relays).toEqual(
    expect.arrayContaining([
      ...DEFAULT_RELAYS,
      ...PROFILE_RELAYS,
      'wss://write.example',
      'wss://read.example',
    ]),
  );
  expect(
    profileReadRelays(Array.from({ length: 100 }, (_, i) => `wss://r${i}.example`)).length,
  ).toBeLessThanOrEqual(42);
});
it.each([false, true])('refuses missing existing kind 0 even with force=%s', async (force) => {
  (queryQuorum as jest.Mock).mockResolvedValue([]);
  await expect(
    publishMergedProfile({
      pubkey,
      relays: [],
      patch: {},
      options: { base, force },
      sign,
      isCurrent: () => true,
    }),
  ).rejects.toBeInstanceOf(SellerFetchError);
  expect(sign).not.toHaveBeenCalled();
  expect(publishSellerEvent).not.toHaveBeenCalled();
});
it('retains the newest verified known revision when relays return an older one', async () => {
  await fetchMerchantProfile(pubkey, []);
  (queryQuorum as jest.Mock).mockResolvedValue([base]);
  const result = await publishMergedProfile({
    pubkey,
    relays: [],
    patch: {},
    options: { base: latest, force: true },
    sign,
    isCurrent: () => true,
  });
  expect(JSON.parse(result.content)).toEqual(JSON.parse(latest.content));
  expect(result.tags).toEqual(latest.tags);
});
it.each(['newer', 'same-second', 'missing', 'offline'])(
  'discards the signature if the post-signing profile is %s',
  async (change) => {
    const newer = profile(300, 'changed during approval');
    const tied = profile(latest.created_at, 'same-second change');
    const ordered = [latest, tied].sort((a, b) => a.id.localeCompare(b.id));
    const initial = change === 'same-second' ? ordered[1] : latest;
    const changed = change === 'same-second' ? ordered[0] : newer;
    // Use a separate author so each scenario starts without retained history.
    const secret = new Uint8Array(32).fill(
      20 + ['newer', 'same-second', 'missing', 'offline'].indexOf(change),
    );
    const author = getPublicKey(secret);
    const first = finalizeEvent({ ...initial }, secret);
    const second = finalizeEvent({ ...changed }, secret);
    const [before, after] =
      change === 'same-second'
        ? [first, second].sort((a, b) => b.id.localeCompare(a.id))
        : [first, second];
    (queryQuorum as jest.Mock).mockResolvedValueOnce([before]);
    if (change === 'offline')
      (queryQuorum as jest.Mock).mockRejectedValueOnce(new Error('Offline'));
    else (queryQuorum as jest.Mock).mockResolvedValueOnce(change === 'missing' ? [] : [after]);
    await expect(
      publishMergedProfile({
        pubkey: author,
        relays: [],
        patch: {},
        options: { base: before, force: true },
        sign: async (t) => finalizeEvent(t, secret),
        isCurrent: () => true,
      }),
    ).rejects.toBeInstanceOf(
      change === 'missing' || change === 'offline' ? SellerFetchError : StaleRevisionError,
    );
    expect(publishSellerEvent).not.toHaveBeenCalled();
  },
);
it('allows an actually new profile after both broad queries find none', async () => {
  const secret = new Uint8Array(32).fill(30);
  (queryQuorum as jest.Mock).mockResolvedValue([]);
  const result = await publishMergedProfile({
    pubkey: getPublicKey(secret),
    relays: [],
    patch: { name: 'First profile' },
    sign: async (t) => finalizeEvent(t, secret),
    isCurrent: () => true,
  });
  expect(JSON.parse(result.content)).toEqual({ name: 'First profile' });
  expect(queryQuorum).toHaveBeenCalledTimes(2);
});
it('refuses an empty query when only display-profile existence is known', async () => {
  (queryQuorum as jest.Mock).mockResolvedValue([]);
  await expect(
    publishMergedProfile({
      pubkey: getPublicKey(new Uint8Array(32).fill(31)),
      relays: [],
      patch: {},
      hasExistingProfile: true,
      sign,
      isCurrent: () => true,
    }),
  ).rejects.toBeInstanceOf(SellerFetchError);
  expect(sign).not.toHaveBeenCalled();
});
