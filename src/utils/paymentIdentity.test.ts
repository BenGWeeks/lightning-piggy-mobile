import { npubEncode } from 'nostr-tools/nip19';
import { paymentRecipientLabel, sanitizeInvoiceMemo } from './paymentIdentity';
import type { NostrContact } from '../types/nostr';

it.each([
  [null, ''],
  ['Coffee ☕', 'Coffee ☕'],
  ['a\n\t\u0000\u007fb', 'ab'],
  ['a\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069b', 'ab'],
  ['a\u200b\u200c\u200d\u2060\ufeffb', 'ab'],
  ['e\u0301', 'é'],
  ['a'.repeat(140), 'a'.repeat(140)],
  ['a'.repeat(141), 'a'.repeat(139) + '…'],
  ['🐷'.repeat(141), '🐷'.repeat(139) + '…'],
])('sanitises invoice memo %p', (input, expected) => {
  expect(sanitizeInvoiceMemo(input)).toBe(expected);
});

const pubkey = 'a'.repeat(64);
const nodePubkey = '02' + 'b'.repeat(64);
const contact: NostrContact = { pubkey, petname: 'Saved friend', relay: null, profile: null };
const base = { contacts: [contact], pubkey, nodePubkey, unknownLabel: 'Unknown recipient' };
it('prefers the actual Lightning address over contact and node labels', () => {
  expect(paymentRecipientLabel({ ...base, address: 'alice@example.com' })).toBe(
    'alice@example.com',
  );
});
it('uses a saved contact name before the node identity', () => {
  expect(paymentRecipientLabel(base)).toBe('Saved friend');
});
it('uses the saved contact npub when its name is missing', () => {
  expect(paymentRecipientLabel({ ...base, contacts: [{ ...contact, petname: null }] })).toBe(
    npubEncode(pubkey),
  );
});
it('does not use unrelated contacts or a caller-supplied name', () => {
  expect(paymentRecipientLabel({ ...base, pubkey: 'c'.repeat(64) })).toBe(
    nodePubkey.slice(0, 12) + '…' + nodePubkey.slice(-8),
  );
});
it.each([null, '', 'invalid'])(
  'falls back to unknown without a verified node identity (%p)',
  (node) => {
    expect(
      paymentRecipientLabel({ contacts: [], nodePubkey: node, unknownLabel: 'Unknown recipient' }),
    ).toBe('Unknown recipient');
  },
);
