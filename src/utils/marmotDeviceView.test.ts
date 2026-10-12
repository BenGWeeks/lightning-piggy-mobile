import type { DeviceInfo } from '../services/marmotDeviceTracker';
import { appsSummary, readableOn, sentFrom } from './marmotDeviceView';

const device = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
  key: Math.random().toString(16).slice(2),
  leafIndex: 0,
  client: 'Lightning Piggy',
  keyCreatedAt: null,
  firstEpoch: 1,
  baseline: false,
  seenAt: null,
  isOwn: false,
  ...over,
});

describe('sentFrom', () => {
  it('a message this device sent is from this device', () => {
    expect(sentFrom([device({ isOwn: true }), device()], true, true)).toEqual({
      kind: 'thisDevice',
    });
  });

  it('our message with only one leaf of ours here must be from this device', () => {
    expect(sentFrom([device({ isOwn: true })], true, false)).toEqual({ kind: 'thisDevice' });
  });

  it('our message from an untracked send when we have two devices: can’t tell which', () => {
    expect(sentFrom([device({ isOwn: true }), device()], true, false)).toEqual({
      kind: 'oneOf',
      count: 2,
    });
  });

  it('names the app of a sender with one device (or null when unknown)', () => {
    expect(sentFrom([device({ client: 'White Noise Android' })], false, false)).toEqual({
      kind: 'app',
      name: 'White Noise Android',
    });
    expect(sentFrom([device({ client: null })], false, false)).toEqual({ kind: 'app', name: null });
  });

  it('names the app when all the sender’s devices are the same app', () => {
    expect(sentFrom([device(), device()], false, false)).toEqual({
      kind: 'app',
      name: 'Lightning Piggy',
    });
  });

  it('says "one of N" when the sender’s devices are different or unknown apps', () => {
    expect(sentFrom([device(), device({ client: 'White Noise' })], false, false)).toEqual({
      kind: 'oneOf',
      count: 2,
    });
    expect(sentFrom([device({ client: null }), device({ client: null })], false, false)).toEqual({
      kind: 'oneOf',
      count: 2,
    });
  });

  it('claims nothing if the sender lost a device around or after the message', () => {
    const one = [device({ client: 'White Noise' })];
    expect(sentFrom(one, false, false, { sentAt: 1000, removedAt: 1050 })).toBeNull();
    expect(sentFrom(one, false, false, { sentAt: 1000, removedAt: 950 })).toBeNull();
    expect(sentFrom(one, false, false, { removedAt: 100 })).toBeNull();
    // Long before the message: today's devices are the ones it came from.
    expect(sentFrom(one, false, false, { sentAt: 1000, removedAt: 500 })).toEqual({
      kind: 'app',
      name: 'White Noise',
    });
    // A tracked send from this phone is certain regardless.
    expect(sentFrom(one, true, true, { sentAt: 1000, removedAt: 1050 })).toEqual({
      kind: 'thisDevice',
    });
  });

  it('is null when the sender has left the chat', () => {
    expect(sentFrom([], false, false)).toBeNull();
    expect(sentFrom(undefined, false, false)).toBeNull();
  });
});

describe('readableOn', () => {
  it('totals every device and lists the viewer last', () => {
    const people = new Map([
      ['me', [device({ isOwn: true }), device()]],
      ['little', [device(), device(), device()]],
    ]);
    expect(readableOn(people, 'ME')).toEqual({
      total: 5,
      people: [
        { pubkey: 'little', count: 3, isSelf: false },
        { pubkey: 'me', count: 2, isSelf: true },
      ],
    });
  });

  it('leaves out devices added (clearly) after the message was sent', () => {
    const people = new Map([
      ['me', [device({ isOwn: true })]],
      ['little', [device(), device({ seenAt: 1_000 + 60 }), device({ seenAt: 1_000 + 3_600 })]],
    ]);
    // The first message of a new 1:1 is written moments before the invite lands.
    expect(readableOn(people, 'me', 1_000)).toEqual({
      total: 3,
      people: [
        { pubkey: 'little', count: 2, isSelf: false },
        { pubkey: 'me', count: 1, isSelf: true },
      ],
    });
    // Unknown time: everyone in the chat now.
    expect(readableOn(people, 'me').total).toBe(4);
  });

  it('drops a person none of whose devices could read it', () => {
    const people = new Map([
      ['me', [device({ isOwn: true })]],
      ['late', [device({ seenAt: 9_999 })]],
    ]);
    expect(readableOn(people, 'me', 1_000).people.map((p) => p.pubkey)).toEqual(['me']);
  });

  it('handles a single-device chat', () => {
    expect(readableOn(new Map([['me', [device({ isOwn: true })]]]), 'me').total).toBe(1);
  });
});

describe('appsSummary', () => {
  it('lists each app once in first-seen order, counting repeats', () => {
    expect(
      appsSummary(['White Noise', 'Lightning Piggy', null, 'Lightning Piggy'], 'Unknown app'),
    ).toBe('White Noise, Lightning Piggy ×2, Unknown app');
  });

  it('groups unknown apps under one label', () => {
    expect(appsSummary([null, null], 'Unknown app')).toBe('Unknown app ×2');
  });
});
