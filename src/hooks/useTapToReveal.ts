import { useCallback, useState } from 'react';
import { useActivePubkey } from './useActivePubkey';
import { isMediaRevealed, markMediaRevealed } from '../services/mediaRevealStore';

/**
 * Tap-to-load state for gated chat media (#1338). `key` must identify the
 * media itself (message id + URL), so an edited URL needs a fresh tap.
 * Returns whether the media may load (`autoLoad`, or this account revealed
 * it earlier this session) and a callback that reveals it.
 */
export function useTapToReveal(key: string, autoLoad: boolean): [boolean, () => void] {
  const owner = useActivePubkey();
  const [, setTick] = useState(0);
  const reveal = useCallback(() => {
    markMediaRevealed(owner, key);
    setTick((n) => n + 1);
  }, [owner, key]);
  return [autoLoad || isMediaRevealed(owner, key), reveal];
}
