import {
  advanceReadMarker,
  firstUnreadId,
  hasUnreadMention,
  latestMentionAt,
  newestEntryMarker,
  unreadCount,
  unreadMentionIds,
  type UnreadEntry,
} from './chatUnread';

const e = (id: string, createdAt: number, fromMe = false, mentionsMe = false): UnreadEntry => ({
  id,
  createdAt,
  fromMe,
  mentionsMe,
});

const thread = [
  e('a', 100),
  e('b', 110, true),
  e('c', 120),
  e('d', 120, false, true),
  e('e', 130, true),
  e('f', 140, false, true),
];

describe('firstUnreadId / unreadCount', () => {
  it('is everything from others after the marker', () => {
    expect(firstUnreadId(thread, { at: 110 })).toBe('c');
    expect(unreadCount(thread, { at: 110 })).toBe(3);
  });

  it('places the marker exactly among same-second messages by id', () => {
    expect(firstUnreadId(thread, { at: 120, id: 'c' })).toBe('d');
    expect(unreadCount(thread, { at: 120, id: 'c' })).toBe(2);
  });

  it('falls back to the timestamp when the marked message is gone', () => {
    expect(firstUnreadId(thread, { at: 120, id: 'gone' })).toBe('f');
  });

  it('skips my own messages', () => {
    expect(firstUnreadId(thread, { at: 125 })).toBe('f');
  });

  it('is null / zero when all read or no marker yet', () => {
    expect(firstUnreadId(thread, { at: 140, id: 'f' })).toBeNull();
    expect(unreadCount(thread, null)).toBe(0);
    expect(firstUnreadId(thread, null)).toBeNull();
  });
});

describe('unreadMentionIds', () => {
  it('lists unread mentions oldest first', () => {
    expect(unreadMentionIds(thread, { at: 100 })).toEqual(['d', 'f']);
    expect(unreadMentionIds(thread, { at: 120, id: 'd' })).toEqual(['f']);
    expect(unreadMentionIds(thread, null)).toEqual([]);
  });
});

describe('advanceReadMarker', () => {
  it('only moves forward', () => {
    const at120 = { at: 120, id: 'c' };
    expect(advanceReadMarker(null, at120)).toBe(at120);
    expect(advanceReadMarker(at120, { at: 110, id: 'b' })).toBe(at120);
    expect(advanceReadMarker(at120, { at: 130, id: 'e' })).toEqual({ at: 130, id: 'e' });
  });

  it('orders same-second positions by the thread when known', () => {
    const order = (id: string) => ({ c: 2, d: 3 })[id];
    const atD = { at: 120, id: 'd' };
    expect(advanceReadMarker(atD, { at: 120, id: 'c' }, order)).toBe(atD);
    expect(advanceReadMarker({ at: 120, id: 'c' }, atD, order)).toBe(atD);
  });

  it('takes a newer report within the same second', () => {
    const prev = { at: 120, id: 'c' };
    expect(advanceReadMarker(prev, { at: 120, id: 'd' })).toEqual({ at: 120, id: 'd' });
    expect(advanceReadMarker(prev, { at: 120, id: 'c' })).toBe(prev);
    expect(advanceReadMarker(prev, { at: 120 })).toBe(prev);
  });
});

describe('newestEntryMarker', () => {
  it('picks the newest visible entry (the later one on ties)', () => {
    expect(newestEntryMarker([e('x', 5), e('y', 9), e('z', 9)])).toEqual({ at: 9, id: 'z' });
    expect(newestEntryMarker([])).toBeNull();
  });

  it('breaks same-second ties by thread order (inverted lists report newest first)', () => {
    const order = (id: string) => ({ y: 1, z: 2 })[id];
    expect(newestEntryMarker([e('z', 9), e('y', 9)], order)).toEqual({ at: 9, id: 'z' });
  });
});

describe('hasUnreadMention', () => {
  it('compares the rollup with the read position', () => {
    expect(hasUnreadMention(150, { at: 140 })).toBe(true);
    expect(hasUnreadMention(140, { at: 140 })).toBe(false);
    expect(hasUnreadMention(undefined, { at: 0 })).toBe(false);
    expect(hasUnreadMention(150, null)).toBe(false);
  });
});

describe('latestMentionAt', () => {
  const msgs = [
    { senderPubkey: 'A', createdAt: 1, hit: true },
    { senderPubkey: 'B', createdAt: 2, hit: true },
    { senderPubkey: 'me', createdAt: 3, hit: true },
    { senderPubkey: 'B', createdAt: 4, hit: false },
  ];
  it('returns the newest mention from someone else', () => {
    expect(latestMentionAt(msgs, 'ME', (m) => m.hit)).toBe(2);
  });
  it('is undefined with no viewer or no mention', () => {
    expect(latestMentionAt(msgs, null, (m) => m.hit)).toBeUndefined();
    expect(latestMentionAt(msgs, 'me', () => false)).toBeUndefined();
  });
});
