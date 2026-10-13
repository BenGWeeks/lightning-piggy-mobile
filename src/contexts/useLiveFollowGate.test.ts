import { act, renderHook } from '@testing-library/react-native';
import { useLiveFollowGate } from './useLiveFollowGate';

it('waits past cache paint and replays only after reconciliation, including an empty result', () => {
  const middle = '4b2fcb4e' + 'a'.repeat(56);
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
