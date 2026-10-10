import { act, renderHook } from '@testing-library/react-native';
import { useAccountDeferredValue, useAccountState } from './useAccountState';

const EMPTY: string[] = [];

it('hides account data during the switch render, including before effects run', () => {
  const renders: string[][] = [];
  const { result, rerender } = renderHook(
    ({ owner }: { owner: string }) => {
      const state = useAccountState(owner, EMPTY);
      renders.push(state[0]);
      return state;
    },
    { initialProps: { owner: 'a' } },
  );
  act(() => result.current[1](['private-a']));
  const firstSwitchRender = renders.length;
  rerender({ owner: 'b' });
  expect(renders.slice(firstSwitchRender).every((value) => value.length === 0)).toBe(true);
});

it('rejects late contact, profile and group callbacks without merging across owners', () => {
  const { result, rerender } = renderHook(
    ({ owner }: { owner: string }) => useAccountState(owner, EMPTY),
    {
      initialProps: { owner: 'a' },
    },
  );
  const lateA = result.current[2]('a');
  act(() => lateA(['a']));
  rerender({ owner: 'b' });
  act(() => result.current[1]((previous) => [...previous, 'b']));
  act(() => lateA(['private-a']));
  expect(result.current[0]).toEqual(['b']);
  rerender({ owner: 'a' });
  expect(result.current[0]).toEqual([]);
});

it('never exposes deferred inbox rows from A during any render for B', () => {
  const renders: { owner: string; rows: string[] }[] = [];
  const { result, rerender } = renderHook(
    ({ owner, rows }: { owner: string; rows: string[] }) => {
      const deferred = useAccountDeferredValue(owner, rows, EMPTY);
      renders.push({ owner, rows: deferred });
      return deferred;
    },
    { initialProps: { owner: 'a', rows: ['private-a'] } },
  );
  expect(result.current).toEqual(['private-a']);
  rerender({ owner: 'b', rows: ['private-b'] });
  const bRenders = renders.filter((render) => render.owner === 'b');
  expect(bRenders.length).toBeGreaterThan(0);
  expect(bRenders[0].rows).toEqual([]);
  expect(bRenders.every((render) => !render.rows.includes('private-a'))).toBe(true);
  expect(result.current).toEqual(['private-b']);
});
