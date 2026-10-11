import type { Event as NostrEvent } from 'nostr-tools';
import {
  deviceAge,
  deviceKind,
  groupInvitationDevices,
  shapeInvitationKeys,
  stillOldDevices,
} from './marmotInvitationDevices';

const DAY = 86400;
const NOW = 100 * DAY;
const owner = 'ab'.repeat(32);
const event = (
  id: string,
  slot = 'slot',
  at = NOW,
  content = 'key',
  client = 'White Noise Android',
): NostrEvent => ({
  id,
  pubkey: owner,
  kind: 30443,
  created_at: at,
  content,
  sig: '',
  tags: [
    ['d', slot],
    ['client', client],
  ],
});
const shape = (events: NostrEvent[], local: string[] = []) =>
  shapeInvitationKeys(owner, [{ relay: 'wss://one.test', events }], local);
const devices = (events: NostrEvent[], local?: string) =>
  groupInvitationDevices(shape(events, local ? [local] : []), local, NOW);

describe('shapeInvitationKeys', () => {
  test('deduplicates relay copies, groups slots and identifies only local slots', () => {
    const a = event('a', 'local');
    const keys = shapeInvitationKeys(
      owner,
      [
        {
          relay: 'wss://one.test',
          events: [a, event('b', 'remote'), { ...a, id: 'foreign', pubkey: 'other' }],
        },
        { relay: 'wss://two.test', events: [a, event('c', 'local', NOW + 1)] },
      ],
      ['local'],
    );
    expect(keys.map((k) => k.event.id)).toEqual(['c', 'a', 'b']);
    expect(keys[1].relays).toEqual(['wss://one.test', 'wss://two.test']);
    expect(keys.map((k) => k.thisPhone)).toEqual([true, true, false]);
  });

  test('an empty newest replacement hides all older slot versions', () => {
    expect(shape([event('a'), event('b', 'slot', NOW + 1, '')])).toEqual([]);
    expect(shape([event('b'), event('a', 'slot', NOW, '')])).toEqual([]);
  });
});

describe('groupInvitationDevices', () => {
  test('one row per device, this phone first, then newest first', () => {
    const rows = devices(
      [
        event('a', 'wn', NOW - 3 * DAY),
        event('b', 'wn', NOW - 9 * DAY),
        event('c', 'lp', NOW - DAY, 'key', 'Lightning Piggy'),
        event('d', 'mine', NOW - 2 * DAY, 'key', 'Lightning Piggy'),
      ],
      'mine',
    );
    expect(rows.map((d) => [d.kind, d.slot, d.versions.length])).toEqual([
      ['thisPhone', 'mine', 1],
      ['lightningPiggy', 'lp', 1],
      ['whiteNoise', 'wn', 2],
    ]);
    expect(rows[2].updatedAt).toBe(NOW - 3 * DAY);
  });

  test('always lists this phone, even when relays hold nothing for it', () => {
    expect(devices([event('a', 'wn')], 'mine')[0]).toMatchObject({
      kind: 'thisPhone',
      slot: 'mine',
      versions: [],
      old: false,
    });
    expect(devices([])[0]).toMatchObject({ kind: 'thisPhone', slot: '' });
  });

  test('old = every version past 30 days or expired, never this phone', () => {
    const keys = shape(
      [
        event('a', 'old', NOW - 31 * DAY),
        event('b', 'mixed', NOW - 40 * DAY),
        event('c', 'mixed', NOW - DAY),
        event('d', 'mine', NOW - 60 * DAY),
        event('e', 'expired', NOW - DAY),
      ],
      ['mine'],
    );
    keys.find((k) => k.event.id === 'e')!.expires = NOW - 1;
    const rows = groupInvitationDevices(keys, 'mine', NOW);
    expect(rows.filter((d) => d.old).map((d) => d.slot)).toEqual(['expired', 'old']);
  });

  test('labels White Noise on any platform and unknown apps separately', () => {
    expect(deviceKind('White Noise iOS', false)).toBe('whiteNoise');
    expect(deviceKind('whitenoise', false)).toBe('whiteNoise');
    expect(deviceKind('Lightning Piggy', false)).toBe('lightningPiggy');
    expect(deviceKind('', false)).toBe('otherApp');
    expect(deviceKind('White Noise', true)).toBe('thisPhone');
  });
});

describe('stillOldDevices (bulk removal, re-decided just before signing)', () => {
  const old = () => devices([event('a', 'gone', NOW - 40 * DAY)]).filter((d) => d.old);

  test('keeps a device relays still show as old', () => {
    expect(stillOldDevices(old(), owner, [event('a', 'gone', NOW - 40 * DAY)], NOW)).toEqual({
      slots: ['gone'],
      eventIds: ['a'],
    });
  });

  test('skips a device refreshed after the list loaded', () => {
    const live = [event('a', 'gone', NOW - 40 * DAY), event('fresh', 'gone', NOW - 60)];
    expect(stillOldDevices(old(), owner, live, NOW)).toEqual({ slots: [], eventIds: [] });
  });

  test('skips a device not seen this time, or already removed', () => {
    expect(stillOldDevices(old(), owner, [], NOW).slots).toEqual([]);
    const retired = [event('a', 'gone', NOW - 40 * DAY), event('x', 'gone', NOW - 10, '')];
    expect(stillOldDevices(old(), owner, retired, NOW).slots).toEqual([]);
  });

  test('ignores another account’s event in the slot, and never keeps this phone', () => {
    const foreign = { ...event('f', 'gone', NOW - 60), pubkey: 'cd'.repeat(32) };
    expect(stillOldDevices(old(), owner, [event('a', 'gone', 1), foreign], NOW).slots).toEqual([
      'gone',
    ]);
    const mine = devices([event('m', 'mine', NOW - 40 * DAY)], 'mine').map((d) => ({
      ...d,
      old: true,
    }));
    expect(stillOldDevices(mine, owner, [event('m', 'mine', 1)], NOW).slots).toEqual([]);
  });
});

test('deviceAge: never, just now, hours, days', () => {
  expect(deviceAge(undefined, NOW)).toEqual({ unit: 'never' });
  expect(deviceAge(NOW - 59 * 60, NOW)).toEqual({ unit: 'justNow' });
  expect(deviceAge(NOW - 5 * 3600, NOW)).toEqual({ unit: 'hours', count: 5 });
  expect(deviceAge(NOW - 3 * DAY - 10, NOW)).toEqual({ unit: 'days', count: 3 });
});
