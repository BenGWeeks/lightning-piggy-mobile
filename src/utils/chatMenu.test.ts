import { chatMenuItems } from './chatMenu';
it.each([false, true])('uses the same tools for each protocol; group=%s', (group) => {
  expect(chatMenuItems(group, false)).toEqual([
    group ? 'group' : 'contact',
    'search',
    'attachments',
    'mute',
    'more',
  ]);
  expect(chatMenuItems(group, true)).toContain('unmute');
  expect(chatMenuItems(group, true)).not.toContain('mute');
});
it('limits More to supported local actions', () => {
  expect(chatMenuItems(false, false, true)).toEqual(['clear']);
  expect(chatMenuItems(true, true, true)).toEqual(['clear']);
});
