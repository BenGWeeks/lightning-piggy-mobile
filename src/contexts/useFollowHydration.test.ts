import { act, renderHook } from '@testing-library/react-native';
import { useFollowHydration } from './useFollowHydration';

it('resets readiness on account changes and rejects reconciliation from an earlier login', () => {
  const { result, rerender } = renderHook<ReturnType<typeof useFollowHydration>, string>(
    (owner) => useFollowHydration(owner),
    { initialProps: 'big' },
  );
  expect(result.current[0]).toBe(false);
  const finishBig = result.current[1]('big');
  act(finishBig);
  expect(result.current[0]).toBe(true);
  act(() => rerender('little'));
  expect(result.current[0]).toBe(false);
  const finishLittle = result.current[1]('little');
  act(() => rerender('big'));
  expect(result.current[0]).toBe(false);
  act(finishBig);
  act(finishLittle);
  expect(result.current[0]).toBe(false);
  act(result.current[1]('big'));
  expect(result.current[0]).toBe(true);
});
