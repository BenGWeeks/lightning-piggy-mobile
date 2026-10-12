import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CHAT_READ_POSITIONS_KEY_BASE,
  PERSIST_DELAY_MS,
  __resetReadPositionsForTests,
  dmReadKey,
  flushReadPositions,
  forgetReadPositions,
  getReadMarker,
  getReadPositionsVersion,
  groupReadKey,
  hydrateReadPositions,
  markConversationRead,
  subscribeReadPositions,
} from './chatReadPositions';

const OWNER = 'f'.repeat(64);
const KEY = `${CHAT_READ_POSITIONS_KEY_BASE}_${OWNER}`;

beforeEach(async () => {
  jest.useRealTimers();
  __resetReadPositionsForTests();
  await AsyncStorage.clear();
});

afterEach(() => __resetReadPositionsForTests());

describe('chatReadPositions', () => {
  it('starts an account at a baseline of "now" and persists it', async () => {
    jest.useFakeTimers({ now: 1_000_000 * 1000 });
    await hydrateReadPositions(OWNER);
    expect(getReadMarker(OWNER, groupReadKey('g1'))).toEqual({ at: 1_000_000 });
    jest.advanceTimersByTime(PERSIST_DELAY_MS);
    jest.useRealTimers();
    await flushReadPositions(OWNER);
    const stored = JSON.parse((await AsyncStorage.getItem(KEY)) as string);
    expect(stored.baseline).toBe(1_000_000);
  });

  it('returns null before hydration and for no owner', () => {
    expect(getReadMarker(OWNER, 'x')).toBeNull();
    expect(getReadMarker(null, 'x')).toBeNull();
  });

  it('hydrates stored markers and drops malformed ones', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        baseline: 50,
        markers: { 'dm:aa': { at: 70, id: 'm1' }, bad: { at: 'x' } },
      }),
    );
    await hydrateReadPositions(OWNER);
    expect(getReadMarker(OWNER, 'dm:aa')).toEqual({ at: 70, id: 'm1' });
    expect(getReadMarker(OWNER, 'bad')).toEqual({ at: 50 });
  });

  it('coalesces many marks into one write after the delay', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ v: 1, baseline: 1, markers: {} }));
    await hydrateReadPositions(OWNER);
    jest.useFakeTimers();
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    setItem.mockClear();
    for (let i = 0; i < 50; i++) markConversationRead(OWNER, 'group:g', { at: 100 + i });
    expect(setItem).not.toHaveBeenCalled();
    jest.advanceTimersByTime(PERSIST_DELAY_MS);
    await Promise.resolve();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(setItem.mock.calls[0][1] as string).markers['group:g']).toEqual({ at: 149 });
  });

  it('never moves a position backwards', async () => {
    await hydrateReadPositions(OWNER);
    markConversationRead(OWNER, 'dm:x', { at: 200, id: 'b' });
    markConversationRead(OWNER, 'dm:x', { at: 150, id: 'a' });
    expect(getReadMarker(OWNER, 'dm:x')).toEqual({ at: 200, id: 'b' });
  });

  it('merges a mark made before hydration landed', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, baseline: 1, markers: { 'dm:x': { at: 100 } } }),
    );
    markConversationRead(OWNER, 'dm:x', { at: 300 });
    await hydrateReadPositions(OWNER);
    expect(getReadMarker(OWNER, 'dm:x')).toEqual({ at: 300 });
    await flushReadPositions(OWNER);
    const stored = JSON.parse((await AsyncStorage.getItem(KEY)) as string);
    expect(stored.markers['dm:x']).toEqual({ at: 300 });
  });

  it('notifies subscribers on hydrate and flush, not on each mark', async () => {
    const listener = jest.fn();
    const unsub = subscribeReadPositions(listener);
    await hydrateReadPositions(OWNER);
    const afterHydrate = listener.mock.calls.length;
    expect(afterHydrate).toBeGreaterThan(0);
    const v = getReadPositionsVersion();
    markConversationRead(OWNER, 'dm:x', { at: 9_999_999_999 });
    expect(listener).toHaveBeenCalledTimes(afterHydrate);
    await flushReadPositions(OWNER);
    expect(listener.mock.calls.length).toBeGreaterThan(afterHydrate);
    expect(getReadPositionsVersion()).toBeGreaterThan(v);
    unsub();
  });

  it('keeps accounts apart and forgets one on sign-out', async () => {
    const other = 'e'.repeat(64);
    await hydrateReadPositions(OWNER);
    await hydrateReadPositions(other);
    markConversationRead(OWNER, 'dm:x', { at: 9_999_999_999 });
    expect(getReadMarker(other, 'dm:x')?.at).not.toBe(9_999_999_999);
    forgetReadPositions(OWNER);
    expect(getReadMarker(OWNER, 'dm:x')).toBeNull();
  });

  it('a read still in flight at sign-out does not resurrect the account', async () => {
    const pending = hydrateReadPositions(OWNER);
    forgetReadPositions(OWNER);
    await pending;
    expect(getReadMarker(OWNER, 'dm:x')).toBeNull();
  });

  it('builds stable conversation keys', () => {
    expect(dmReadKey('ABC')).toBe('dm:abc');
    expect(groupReadKey('marmot:xyz')).toBe('group:marmot:xyz');
  });
});

it("signing one account out doesn't cancel another's pending hydration", async () => {
  const other = 'e'.repeat(64);
  const pending = hydrateReadPositions(other);
  forgetReadPositions(OWNER);
  await pending;
  expect(getReadMarker(other, 'dm:x')).not.toBeNull();
});
