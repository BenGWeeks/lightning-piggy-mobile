import { chatUnreadEntries, unreadDividerId, type UnreadTimelineItem } from './unreadDivider';

const message = (id: string, createdAt: number, fromMe = false): UnreadTimelineItem => ({
  kind: 'message',
  id,
  createdAt,
  fromMe,
});
const items = [message('read', 10), message('first', 20), message('newest', 30)];

describe.each([false, true])('divider placement (inverted=%s)', (inverted) => {
  const data = (rows: UnreadTimelineItem[]) => (inverted ? [...rows].reverse() : rows);

  it('sits above the newest message when only that message is unread', () => {
    expect(unreadDividerId(data(items), { at: 20, id: 'first' }, inverted)).toBe('newest');
  });

  it('sits above the oldest of several unread messages', () => {
    expect(unreadDividerId(data(items), { at: 10, id: 'read' }, inverted)).toBe('first');
  });

  it('has no divider for an empty, fully read, future-marker or unhydrated thread', () => {
    expect(unreadDividerId([], { at: 0 }, inverted)).toBeNull();
    expect(unreadDividerId(data(items), { at: 30, id: 'newest' }, inverted)).toBeNull();
    expect(unreadDividerId(data(items), { at: 100, id: 'missing' }, inverted)).toBeNull();
    expect(unreadDividerId(data(items), null, inverted)).toBeNull();
  });

  it('never counts synthetic rows as unread or advances the read position through them', () => {
    const synthetic = ['deviceNotice', 'marmotInviteFailed', 'dayHeader'].map((kind) => ({
      kind,
      id: kind,
      createdAt: 40,
      fromMe: false,
    }));
    const rows = data([...items, ...synthetic]);
    expect(chatUnreadEntries(rows, inverted).map((entry) => entry.id)).toEqual([
      'read',
      'first',
      'newest',
    ]);
    expect(unreadDividerId(rows, { at: 30 }, inverted)).toBeNull();
    expect(unreadDividerId(rows, { at: 20 }, inverted)).toBe('newest');
  });

  it('skips own messages in mixed and own-only tails', () => {
    const rows = data([message('read', 10), message('own', 20, true), message('other', 30)]);
    expect(unreadDividerId(rows, { at: 10 }, inverted)).toBe('other');
    expect(unreadDividerId(rows, { at: 30 }, inverted)).toBeNull();
    expect(
      unreadDividerId(data([message('read', 10), message('own', 20, true)]), { at: 10 }, inverted),
    ).toBeNull();
  });

  it('uses ids to distinguish messages in the same second', () => {
    const rows = data([message('a', 10), message('b', 10)]);
    expect(unreadDividerId(rows, { at: 10, id: 'a' }, inverted)).toBe('b');
  });

  it('keeps the opening boundary while reading, then hides it when all messages are read', () => {
    const rows = data([...items, message('arrival', 40)]);
    expect(unreadDividerId(rows, { at: 20 }, inverted, 'first')).toBe('first');
    expect(unreadDividerId(rows, { at: 40 }, inverted, 'first')).toBeNull();
    expect(unreadDividerId(rows, { at: 20 }, inverted, null)).toBeNull();
    expect(unreadDividerId(rows, { at: 20 }, inverted, 'deleted')).toBeNull();
    expect(unreadDividerId(rows, { at: 10 }, inverted, 'arrival')).toBeNull();
  });
});
