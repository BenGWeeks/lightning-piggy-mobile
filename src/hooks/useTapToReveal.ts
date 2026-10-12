import { useCallback, useState } from 'react';

// Media the user has tapped to load this session, keyed by message + kind.
// Module scope so a FlatList row that unmounts and remounts (scrolling,
// re-render) doesn't ask again. Not persisted: a fresh session re-gates.
const revealed = new Set<string>();

/**
 * Tap-to-load state for gated chat media (#1338). Returns whether the media
 * may load (`autoLoad` or previously revealed) and a callback that reveals it.
 */
export function useTapToReveal(key: string, autoLoad: boolean): [boolean, () => void] {
  const [, setTick] = useState(0);
  const reveal = useCallback(() => {
    revealed.add(key);
    setTick((n) => n + 1);
  }, [key]);
  return [autoLoad || revealed.has(key), reveal];
}

/** Test-only. */
export function __resetRevealedForTests(): void {
  revealed.clear();
}
