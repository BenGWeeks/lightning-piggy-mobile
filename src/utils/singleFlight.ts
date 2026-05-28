// Wraps an async producer so that while one call is still pending, further calls
// are dropped (resolve to `undefined`) instead of starting a second run. Used to
// stop interval ticks stacking when the wrapped call outlasts the interval — e.g.
// a balance poll on a slow relay that takes longer than its tick cadence (#650).
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T | undefined> {
  let inFlight = false;
  return async () => {
    if (inFlight) return undefined;
    inFlight = true;
    try {
      return await fn();
    } finally {
      inFlight = false;
    }
  };
}
