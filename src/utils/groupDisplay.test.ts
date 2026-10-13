import { groupDisplay } from './groupDisplay';

it('keeps clean group snapshots stable', () => {
  const group = { id: 'g', name: 'Family' };
  expect(groupDisplay(group)).toBe(group);
});
it.each([
  ['Fa\u202emily\u200b', 'Family'],
  ['x'.repeat(65), 'x'.repeat(63) + '…'],
])('sanitises untrusted group labels', (name, expected) => {
  const group = { id: 'g', name };
  expect(groupDisplay(group)).toEqual({ id: 'g', name: expected });
  expect(group.name).toBe(name);
});
