import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` of
 * quiet (no further changes). Used to keep keystroke-driven work (e.g.
 * re-filtering a list on every search character) off the typing path: the
 * input stays responsive while the expensive derived work runs once the user
 * pauses.
 *
 * The first value is returned synchronously (no initial delay), so an empty
 * query shows everything immediately on mount.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
