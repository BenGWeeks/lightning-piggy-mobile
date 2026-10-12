import { groupSenderRunStarts, senderInitials } from './groupSenderRuns';

test('avatars mark only the first incoming message of each chronological sender run', () => {
  const rows = [
    { id: 'a1', senderPubkey: 'Alice' },
    { id: 'a2', senderPubkey: 'ALICE' },
    { id: 'b1', senderPubkey: 'Bob' },
    { id: 'a3', senderPubkey: 'alice' },
    { id: 'self', senderPubkey: 'ME' },
    { id: 'a4', senderPubkey: 'alice' },
    { id: 'notice' },
    { id: 'a5', senderPubkey: 'alice' },
  ];
  expect([...groupSenderRunStarts(rows, 'me')]).toEqual(['a1', 'b1', 'a3', 'a4', 'a5']);
  expect([...groupSenderRunStarts([], null)]).toEqual([]);
});

test('initials handle multi-word, single-word and Unicode display names', () => {
  expect(senderInitials(' Curious Fox (JG Mac) ')).toBe('CF');
  expect(senderInitials('Марія')).toBe('М');
  expect(senderInitials('🐷 Piggy')).toBe('🐷P');
  expect(senderInitials('')).toBe('?');
});
