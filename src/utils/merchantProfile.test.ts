import type { Event } from 'nostr-tools';
import { mergeMerchantProfile, paymentPreferenceOf } from './merchantProfile';
const event = {
  kind: 0,
  created_at: 10,
  content: JSON.stringify({
    name: 'Merchant',
    picture: 'avatar',
    lud16: 'pay@example.com',
    cashu: ['mint'],
    custom: { nested: true },
    empty: '',
    flag: false,
  }),
  tags: [
    ['client', 'other'],
    ['custom', 'a', 'b'],
    ['payment_preference', 'manual'],
    ['payment_preference', 'ecash'],
  ],
} as Event;
it.each(['manual', 'ecash', 'lud16'] as const)(
  'merges %s while preserving all profile fields and unrelated tags',
  (preference) => {
    const merged = mergeMerchantProfile(event, {}, preference);
    expect(merged.kind).toBe(0);
    expect(JSON.parse(merged.content)).toEqual(JSON.parse(event.content));
    expect(merged.tags).toEqual([
      ['client', 'other'],
      ['custom', 'a', 'b'],
      ['payment_preference', preference],
    ]);
    expect(merged.created_at).toBeGreaterThan(event.created_at);
  },
);
it('normal profile edits retain merchant preferences and unknown fields', () => {
  const merged = mergeMerchantProfile(event, { name: 'New name', about: '', picture: undefined });
  expect(JSON.parse(merged.content)).toEqual({ ...JSON.parse(event.content), name: 'New name' });
  expect(merged.tags).toEqual(event.tags);
});
it('defaults absent or invalid preferences to manual and fails closed on malformed content', () => {
  expect(paymentPreferenceOf(null)).toBe('manual');
  expect(paymentPreferenceOf({ ...event, tags: [['payment_preference', 'invalid']] })).toBe(
    'manual',
  );
  expect(() => mergeMerchantProfile({ ...event, content: '[]' }, {}, 'manual')).toThrow();
  expect(() => mergeMerchantProfile({ ...event, content: 'bad' }, {}, 'manual')).toThrow();
});
