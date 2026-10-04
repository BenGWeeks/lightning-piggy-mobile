// Live and recovery callers share one broadcast result. Successful results stay
// cached for this process so a stale recovery snapshot cannot broadcast twice.
const claims = new Map<string, Promise<string>>();
const completed: string[] = [];
export function singleFlightClaim(key: string, claim: () => Promise<string>): Promise<string> {
  const existing = claims.get(key);
  if (existing) return existing;
  const pending = Promise.resolve()
    .then(claim)
    .then(
      (txid) => {
        completed.push(key);
        if (completed.length > 128) claims.delete(completed.shift()!);
        return txid;
      },
      (error: unknown) => {
        claims.delete(key);
        throw error;
      },
    );
  claims.set(key, pending);
  return pending;
}
