import { useCallback, useRef, useState } from 'react';

/** Keep the switch responsive while serialising permission / registration work. */
export const useOptimisticSwitch = (
  value: boolean,
  setValue: (value: boolean) => void,
  onError: () => void,
) => {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (next: boolean, operation: () => Promise<boolean | void>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setValue(next);
      setPending(true);
      try {
        if ((await operation()) === false) setValue(value);
      } catch {
        setValue(value);
        onError();
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [value, setValue, onError],
  );

  return { pending, run };
};
