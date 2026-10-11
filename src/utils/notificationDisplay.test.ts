import { notificationDisplay, GENERIC_MESSAGE_TITLES } from './notificationDisplay';
import { fallbackName } from './conversationSummaries';

const PEER = 'dd814f561802e8173af55735f2235fb532d08585f53b9dfb045bdf5df5a535fe';
const none = () => undefined;

describe('notificationDisplay', () => {
  it('names a 1:1 row from the profile the Messages list uses, with its avatar', () => {
    const shown = notificationDisplay(
      { kind: 'dm', title: 'New message', data: { conversationPubkey: PEER } },
      {
        partner: PEER.toUpperCase(),
        profileFor: (pk) =>
          pk === PEER ? { name: 'Nodie', picture: 'https://p/n.png' } : undefined,
        groupFor: none,
      },
    );
    expect(shown).toEqual({ title: 'Nodie', picture: 'https://p/n.png' });
  });

  it('falls back to the npub (like Messages) — never a bare "New message"', () => {
    const shown = notificationDisplay(
      { kind: 'dm', title: 'New message', data: { conversationPubkey: PEER } },
      { partner: PEER, profileFor: none, groupFor: none },
    );
    expect(shown).toEqual({ title: fallbackName(PEER), picture: null });
    expect(shown.title.startsWith('npub1')).toBe(true);
  });

  it('keeps a real name the alert carried when no profile is loaded', () => {
    expect(
      notificationDisplay(
        { kind: 'dm', title: 'Max', data: { conversationPubkey: PEER } },
        { partner: PEER, profileFor: none, groupFor: none },
      ).title,
    ).toBe('Max');
  });

  it("names a group row from the group's current name", () => {
    const groupFor = (id: string) => (id === 'marmot:g' ? { name: 'Marmot Protocol' } : undefined);
    expect(
      notificationDisplay(
        { kind: 'group', title: 'New group message', data: { groupId: 'marmot:g' } },
        { profileFor: none, groupFor },
      ),
    ).toEqual({ title: 'Marmot Protocol', picture: null });
    expect(
      notificationDisplay(
        { kind: 'group', title: 'Old name', data: { groupId: 'gone' } },
        { profileFor: none, groupFor },
      ).title,
    ).toBe('Old name');
  });

  it('leaves rows without a resolvable sender (generic pings, payments) as fired', () => {
    expect(
      notificationDisplay(
        { kind: 'dm', title: 'New message', data: { marmotPush: true } },
        { profileFor: none, groupFor: none },
      ),
    ).toEqual({ title: 'New message', picture: null });
    expect(
      notificationDisplay(
        { kind: 'payment', title: 'Payment received', data: {} },
        { profileFor: none, groupFor: none },
      ).title,
    ).toBe('Payment received');
  });

  it('treats every generic title the app fires as unnamed', () => {
    for (const t of ['New message', 'New messages', 'New encrypted message', 'New group message'])
      expect(GENERIC_MESSAGE_TITLES.has(t)).toBe(true);
  });
});
