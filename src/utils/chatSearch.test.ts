import { searchMessages, searchRanges } from './chatSearch';
it('matches literal punctuation, casing, repeated text and Unicode offsets', () => {
  expect(searchRanges('😀 Piggy piggy PIGGY', 'piggy')).toEqual([
    { start: 3, end: 8 },
    { start: 9, end: 14 },
    { start: 15, end: 20 },
  ]);
  expect(searchRanges('a+b [a+b]', 'a+b')).toEqual([
    { start: 0, end: 3 },
    { start: 5, end: 8 },
  ]);
  expect(searchRanges('Привіт світе', 'СВІТЕ')).toEqual([{ start: 7, end: 12 }]);
  expect(searchRanges('İx', 'x')).toEqual([{ start: 1, end: 2 }]);
});
it('ignores empty queries and returns newest-first matching message IDs', () => {
  const messages = [
    { id: 'old', text: 'Hello', createdAt: 1 },
    { id: 'other', text: 'Bye', createdAt: 3 },
    { id: 'new', text: 'HELLO hello', createdAt: 2 },
  ];
  expect(searchMessages(messages, ' hello ')).toEqual(['new', 'old']);
  expect(searchMessages(messages, '   ')).toEqual([]);
  expect(searchMessages(messages, 'absent')).toEqual([]);
});
