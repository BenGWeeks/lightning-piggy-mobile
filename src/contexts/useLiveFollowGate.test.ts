import { act, renderHook } from '@testing-library/react-native';
import { useLiveFollowGate } from './useLiveFollowGate';
import { adoptFollowSnapshot } from '../services/contactFollowFreshness';
import { gateLiveDm } from './liveDmFollowGateDecision';

jest.mock('../services/contactListSync', () => ({ fetchLatestContactList: jest.fn() }));

const MIDDLE = '4b2fcb4e3c30c1363c4af5e3a6adebfe93cd572c3d57c31aaa4479d908612036';
const LITTLE = 'd9b33280' + 'a'.repeat(56);
const OTHER = 'b'.repeat(64);
const BIG = 'f'.repeat(64);
const contacts = [MIDDLE, LITTLE, OTHER].map((pubkey) => ({
  pubkey,
  relay: null,
  petname: null,
  profile: null,
}));

it('adoption updates the live refs and drains both kinds before UI hydration commits (#1458)', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { result, rerender, unmount } = renderHook(() =>
    useLiveFollowGate(new Set<string>(), false, BIG),
  );
  const gate = result.current;
  const replay = jest.fn();
  gate.deferredReplayRef.current = replay;
  const input = (id: string, kind: 4 | 1059, partner = MIDDLE) => ({
    entry: {
      id,
      partnerPubkey: partner,
      fromMe: false,
      createdAt: 100,
      text: 'hello',
      wireKind: kind === 4 ? 4 : 14,
    },
    kind,
    follows: gate.followPubkeysRef.current,
    hydrated: gate.followHydratedRef.current,
    buffer: gate.followGateBufferRef.current,
    fresh: false,
  });
  expect(gateLiveDm(input('kind4', 4))).toBe('defer');
  expect(gateLiveDm(input('wrap', 1059, LITTLE))).toBe('defer');
  expect(gateLiveDm(input('stranger', 4, 'c'.repeat(64)))).toBe('defer');
  // UI remains at the pre-hydration props: adoption must not wait for a transition/effect.
  await act(async () => {
    await adoptFollowSnapshot(BIG, { contacts, createdAt: 1791834639 });
    expect(gate.followHydratedRef.current).toBe(true);
    expect(gate.followPubkeysRef.current.has(MIDDLE)).toBe(true);
    expect(gateLiveDm(input('middle-after', 4))).toBe('pass');
    expect(gateLiveDm(input('little-after', 1059, LITTLE))).toBe('pass');
  });
  expect(replay.mock.calls.map(([item]) => item.entry.id)).toEqual(['kind4', 'wrap']);
  expect(gate.followGateBufferRef.current.size).toBe(0);
  // Babel strips console.log in ordinary Jest runs; the diagnostic run retains it.
  if (process.env.EXPO_PUBLIC_KEEP_PERF_LOGS === '1') {
    expect(log).toHaveBeenCalledWith('[Nostr] follow-gate replay: 2 released, 1 dropped');
    expect(log).toHaveBeenCalledWith('[Nostr] follow set: 3 follows (kind-3 1791834639)');
  }
  // A stale UI render must not overwrite the adopted live refs or re-defer forever.
  act(() => rerender({}));
  expect(gateLiveDm(input('middle-later', 4))).toBe('pass');
  expect(replay).toHaveBeenCalledTimes(2);
  unmount();
  log.mockRestore();
});

it('ignores another account and unsubscribes on account switch', async () => {
  const { result, rerender, unmount } = renderHook(
    (owner: string) => useLiveFollowGate(new Set<string>(), false, owner),
    { initialProps: BIG },
  );
  await act(async () => {
    await adoptFollowSnapshot(OTHER, { contacts, createdAt: 100 });
  });
  expect(result.current.followHydratedRef.current).toBe(false);
  act(() => rerender(OTHER));
  await act(async () => {
    await adoptFollowSnapshot(BIG, { contacts, createdAt: 1791834640 });
  });
  expect(result.current.followHydratedRef.current).toBe(false);
  unmount();
});

it('waits past cache paint and replays only after reconciliation, including an empty result', () => {
  const middle = MIDDLE;
  const { result, rerender } = renderHook<
    ReturnType<typeof useLiveFollowGate>,
    { follows: Set<string>; hydrated: boolean }
  >(({ follows, hydrated }) => useLiveFollowGate(follows, hydrated), {
    initialProps: { follows: new Set<string>(), hydrated: false },
  });
  const replay = jest.fn();
  result.current.deferredReplayRef.current = replay;
  result.current.followGateBufferRef.current.defer({
    partnerPubkey: middle,
    entry: {
      id: 'kind4',
      partnerPubkey: middle,
      fromMe: false,
      createdAt: 100,
      text: 'hello',
      wireKind: 4,
    },
  });
  act(() => rerender({ follows: new Set([middle]), hydrated: false }));
  expect(replay).not.toHaveBeenCalled();
  act(() => rerender({ follows: new Set([middle]), hydrated: true }));
  act(() => rerender({ follows: new Set([middle]), hydrated: true }));
  expect(replay).toHaveBeenCalledTimes(1);
  expect(result.current.followHydratedRef.current).toBe(true);
  result.current.followGateBufferRef.current.defer({
    partnerPubkey: middle,
    entry: {
      id: 'stranger',
      partnerPubkey: middle,
      fromMe: false,
      createdAt: 100,
      text: 'hello',
      wireKind: 4,
    },
  });
  act(() => rerender({ follows: new Set(), hydrated: true }));
  expect(replay).toHaveBeenCalledTimes(1);
  expect(result.current.followGateBufferRef.current.size).toBe(0);
});
