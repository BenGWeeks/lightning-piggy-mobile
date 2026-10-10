import {
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

/** Account-owned state: hide stale values during render and reject late writers. */
export function useAccountState<T>(owner: string | null, empty: T) {
  const active = useRef(owner);
  active.current = owner;
  const [state, setState] = useState({ owner, value: empty });
  const setterFor = useCallback(
    (writer: string | null): Dispatch<SetStateAction<T>> =>
      (action) => {
        setState((previous) => {
          if (active.current !== writer) return previous;
          const base = previous.owner === writer ? previous.value : empty;
          const value = typeof action === 'function' ? (action as (v: T) => T)(base) : action;
          return previous.owner === writer && value === previous.value
            ? previous
            : { owner: writer, value };
        });
      },
    [empty],
  );
  const setValue = useMemo(() => setterFor(owner), [setterFor, owner]);
  return [state.owner === owner ? state.value : empty, setValue, setterFor] as const;
}

/** Defer expensive list inputs within an account, never across an account switch. */
export function useAccountDeferredValue<T>(owner: string | null, value: T, empty: T): T {
  const snapshot = useMemo(() => ({ owner, value }), [owner, value]);
  const deferred = useDeferredValue(snapshot);
  return deferred.owner === owner ? deferred.value : empty;
}
