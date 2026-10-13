import { useCallback, useRef, useState } from 'react';

/** Readiness belongs to this login session, even when returning to the same account. */
export function useFollowHydration(owner: string | null) {
  const session = useRef({ owner, generation: 0 });
  if (session.current.owner !== owner) {
    session.current = { owner, generation: session.current.generation + 1 };
  }
  const [readyGeneration, setReadyGeneration] = useState(-1);
  const setterFor = useCallback((writer: string) => {
    const generation = session.current.generation;
    return () => {
      if (session.current.owner === writer && session.current.generation === generation) {
        setReadyGeneration(generation);
      }
    };
  }, []);
  return [readyGeneration === session.current.generation, setterFor] as const;
}
