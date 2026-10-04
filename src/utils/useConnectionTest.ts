import { useCallback, useEffect, useRef, useState } from 'react';

export type ConnectionCheckState =
  | { phase: 'idle' | 'checking' | 'success' }
  | { phase: 'error'; reason: 'failed' | 'timeout' };
const IDLE: ConnectionCheckState = { phase: 'idle' };

/** A result describes one explicit check of one draft, never a live status. */
export function useConnectionTest(
  inputKey: string,
  probe: (signal: AbortSignal) => Promise<unknown>,
  timeoutMs = 10000,
  active = true,
) {
  const [result, setResult] = useState<{ key: string; state: ConnectionCheckState }>({
    key: inputKey,
    state: IDLE,
  });
  const keyRef = useRef(inputKey);
  keyRef.current = inputKey;
  const operation = useRef<{
    controller: AbortController;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const cancel = useCallback(() => {
    const active = operation.current;
    operation.current = null;
    if (active) {
      clearTimeout(active.timer);
      active.controller.abort();
    }
  }, []);
  useEffect(() => {
    cancel();
    setResult({ key: inputKey, state: IDLE });
    return cancel;
  }, [inputKey, active, cancel]);

  const run = useCallback(() => {
    if (!active) return;
    cancel();
    const controller = new AbortController();
    const isCurrent = () =>
      operation.current?.controller === controller && keyRef.current === inputKey;
    const finish = (state: ConnectionCheckState) => {
      if (!isCurrent()) return;
      const active = operation.current;
      operation.current = null;
      if (active) clearTimeout(active.timer);
      setResult({ key: inputKey, state });
    };
    const timer = setTimeout(() => {
      if (!isCurrent()) return;
      finish({ phase: 'error', reason: 'timeout' });
      controller.abort();
    }, timeoutMs);
    operation.current = { controller, timer };
    setResult({ key: inputKey, state: { phase: 'checking' } });
    // Promise.resolve also contains a synchronously throwing probe. Rejections
    // from native calls that finish after cancellation are always observed.
    Promise.resolve()
      .then(() => {
        if (!controller.signal.aborted) return probe(controller.signal);
      })
      .then(
        () => finish({ phase: 'success' }),
        () => finish({ phase: 'error', reason: 'failed' }),
      );
  }, [inputKey, probe, timeoutMs, active, cancel]);

  return { state: active && result.key === inputKey ? result.state : IDLE, run, cancel };
}
