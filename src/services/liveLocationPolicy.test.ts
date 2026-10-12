import {
  LIVE_UPDATE_HEARTBEAT_MS,
  LIVE_UPDATE_MIN_INTERVAL_MS,
  createLiveUpdateDispatcher,
  shouldSendUpdate,
  transportFor,
} from './liveLocationPolicy';
import type { OutgoingSession } from './liveLocationStateMachine';

const here = { lat: 51.5, lon: -0.12, accuracyMeters: 5 };
// ~111 m north per 0.001° of latitude.
const moved = (metres: number) => ({ ...here, lat: here.lat + metres / 111_000 });
const T0 = 1_760_000_000_000;

describe('shouldSendUpdate', () => {
  const last = { at: T0, location: here };
  it('sends the first update', () => {
    expect(shouldSendUpdate({ now: T0, last: null, location: here, transport: 'marmot' })).toBe(
      true,
    );
  });
  it('never sends within the minimum interval, however far you moved', () => {
    expect(
      shouldSendUpdate({
        now: T0 + LIVE_UPDATE_MIN_INTERVAL_MS - 1,
        last,
        location: moved(500),
        transport: 'nip17',
      }),
    ).toBe(false);
  });
  it('sends after the interval only on meaningful movement', () => {
    const now = T0 + LIVE_UPDATE_MIN_INTERVAL_MS;
    expect(shouldSendUpdate({ now, last, location: moved(10), transport: 'marmot' })).toBe(false);
    expect(shouldSendUpdate({ now, last, location: moved(40), transport: 'marmot' })).toBe(true);
  });
  it('heartbeats when still — slower on Marmot, whose updates relays store', () => {
    const at = (ms: number, transport: 'marmot' | 'nip17') =>
      shouldSendUpdate({ now: T0 + ms, last, location: here, transport });
    expect(at(LIVE_UPDATE_HEARTBEAT_MS.nip17, 'nip17')).toBe(true);
    expect(at(LIVE_UPDATE_HEARTBEAT_MS.nip17, 'marmot')).toBe(false);
    expect(at(LIVE_UPDATE_HEARTBEAT_MS.marmot, 'marmot')).toBe(true);
  });
  it('caps an 8 h Marmot share at 960 updates moving, 96 still', () => {
    const eightHours = 8 * 3_600_000;
    expect(eightHours / LIVE_UPDATE_MIN_INTERVAL_MS).toBe(960);
    expect(eightHours / LIVE_UPDATE_HEARTBEAT_MS.marmot).toBe(96);
  });
});

describe('transportFor', () => {
  it('routes Marmot 1:1s and groups over Marmot, everything else over NIP-17', () => {
    expect(transportFor({ protocol: 'marmot' })).toBe('marmot');
    expect(transportFor({ groupId: 'marmot:ab' })).toBe('marmot');
    expect(transportFor({})).toBe('nip17');
  });
});

const session = (over: Partial<OutgoingSession> = {}): OutgoingSession => ({
  sessionId: 's1',
  senderPubkey: 'me',
  recipientPubkey: 'peer',
  startedAt: T0,
  durationMs: 3_600_000,
  lastPingAt: null,
  status: 'active',
  startMarkerSent: true,
  endMarkerSent: false,
  ...over,
});
const fix = (location = here, ts = T0) => ({ location, heading: null, ts });

describe('createLiveUpdateDispatcher', () => {
  it('sends only for active, started, unexpired sessions', async () => {
    const d = createLiveUpdateDispatcher();
    const send = jest.fn().mockResolvedValue(true);
    const sent = await d.handleFix(
      fix(),
      [
        session({ sessionId: 'ok' }),
        session({ sessionId: 'paused', status: 'paused' }),
        session({ sessionId: 'ended', status: 'ended' }),
        session({ sessionId: 'nostart', startMarkerSent: false }),
        session({ sessionId: 'late', startedAt: T0 - 3_600_000 }),
      ],
      send,
      T0,
    );
    expect(sent).toEqual(['ok']);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toEqual({
      lat: here.lat,
      lon: here.lon,
      accuracy: 5,
      heading: null,
      ts: T0,
      sessionId: 'ok',
    });
  });

  it('measures the cadence from the start fix it was seeded with', async () => {
    const d = createLiveUpdateDispatcher();
    const send = jest.fn().mockResolvedValue(true);
    d.seed('s1', here, T0);
    expect(await d.handleFix(fix(moved(100)), [session()], send, T0 + 5_000)).toEqual([]);
    expect(await d.handleFix(fix(moved(100)), [session()], send, T0 + 31_000)).toEqual(['s1']);
    // Next one measured from the update just sent.
    expect(await d.handleFix(fix(moved(110)), [session()], send, T0 + 62_000)).toEqual([]);
  });

  it('drops (never queues) a fix while the session has a send in flight', async () => {
    const d = createLiveUpdateDispatcher();
    let release!: (ok: boolean) => void;
    const send = jest.fn(() => new Promise<boolean>((r) => (release = r)));
    const first = d.handleFix(fix(), [session()], send, T0);
    await d.handleFix(fix(moved(500)), [session()], send, T0 + 300_000);
    expect(send).toHaveBeenCalledTimes(1);
    release(true);
    expect(await first).toEqual(['s1']);
  });

  it('a failed send leaves the cadence untouched so the next fix retries', async () => {
    const d = createLiveUpdateDispatcher();
    const send = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue(true);
    expect(await d.handleFix(fix(), [session()], send, T0)).toEqual([]);
    expect(await d.handleFix(fix(), [session()], send, T0 + 1)).toEqual([]);
    expect(await d.handleFix(fix(), [session()], send, T0 + 2)).toEqual(['s1']);
  });

  it('forget / reset clear a session', async () => {
    const d = createLiveUpdateDispatcher();
    const send = jest.fn().mockResolvedValue(true);
    d.seed('s1', here, T0);
    d.forget('s1');
    expect(await d.handleFix(fix(), [session()], send, T0 + 1)).toEqual(['s1']);
    d.reset();
    expect(await d.handleFix(fix(), [session()], send, T0 + 2)).toEqual(['s1']);
  });
});
