import { finalizeEvent, getPublicKey, verifyEvent, type Event } from 'nostr-tools';
import { fetchMerchantProfile, publishMergedProfile } from './merchantProfileService';
import { queryQuorum, verifiedOwnEvents, publishSellerEvent } from './marketSellerService';
import { SellerFetchError, StaleRevisionError } from '../utils/marketSellerRevision';
jest.mock('./marketSellerService', () => ({
  queryQuorum: jest.fn(),
  verifiedOwnEvents: jest.fn(),
  publishSellerEvent: jest.fn(),
}));
const key = new Uint8Array(32).fill(8);
const pubkey = getPublicKey(key);
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
const base = profile(100);
const latest = profile(200, { latest: true });
beforeEach(() => {
  jest.clearAllMocks();
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
    ['wss://example.com'],
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
