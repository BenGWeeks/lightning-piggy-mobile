import { renderHook } from '@testing-library/react-native';
import type { DeviceNoticeView } from '../services/marmotDeviceTracker';
import {
  isDeviceNoticeRow,
  mergeDeviceNotices,
  useGroupTimeline,
  type ClassifiedMessage,
} from './useGroupTimeline';

it.each(['local_pending', 'c'.repeat(64)])(
  'resolves the quoted parent of an own group reply before and after echo (%s)',
  (id) => {
    const me = 'a'.repeat(64);
    const peer = 'b'.repeat(64);
    const parent = { id: 'd'.repeat(64), createdAt: 1, senderPubkey: peer, text: 'original' };
    const reply = { id, createdAt: 2, senderPubkey: me, text: 'reply', replyTo: parent.id };
    const { result } = renderHook(() =>
      useGroupTimeline({
        messages: [parent, reply],
        myPubkey: me,
        memberNameByPubkey: new Map([[peer, 'Little Piggy']]),
        formatLocale: 'en',
        deviceNotices: [],
      }),
    );
    expect(result.current.rows[1]).toMatchObject({
      id,
      quote: { text: 'original', fromMe: false, authorName: 'Little Piggy' },
    });
  },
);

const msg = (id: string, createdAt: number) =>
  ({ id, createdAt, senderPubkey: 'a', text: id }) as unknown as ClassifiedMessage;
const notice = (id: string, at: number): DeviceNoticeView => ({
  id,
  at,
  epoch: 1,
  pubkey: 'b',
  joined: true,
  keys: ['k1', 'k2'],
  clients: ['Lightning Piggy', null],
});

describe('mergeDeviceNotices', () => {
  it('returns the messages untouched when there are no notices', () => {
    const messages = [msg('m1', 10)];
    expect(mergeDeviceNotices(messages, [])).toBe(messages);
  });

  it('puts each notice before the first newer message, keeping message order', () => {
    const rows = mergeDeviceNotices(
      [msg('m1', 10), msg('m2', 20), msg('m3', 30)],
      [notice('n0', 5), notice('n1', 15), notice('n2', 40)],
    );
    expect(rows.map((r) => r.id)).toEqual([
      'device-n0',
      'm1',
      'device-n1',
      'm2',
      'm3',
      'device-n2',
    ]);
    const first = rows[0];
    expect(isDeviceNoticeRow(first) && first).toMatchObject({
      createdAt: 5,
      pubkey: 'b',
      joined: true,
      clients: ['Lightning Piggy', null],
    });
    expect(isDeviceNoticeRow(rows[1])).toBe(false);
  });

  it('shows notices in an empty chat', () => {
    expect(mergeDeviceNotices([], [notice('n', 1)]).map((r) => r.id)).toEqual(['device-n']);
  });
});
