/** Probe outcomes are independent of account pool membership. */
export type ProbeError = 'timeout' | 'refused' | 'tls' | 'closed';
export type ProbeResult = { reachable: boolean; checkedAt: number; error?: ProbeError };
export type ProbeEvent = 'message' | 'timeout' | 'error' | 'close';
export const PROBE_TIMEOUT_MS = 6000;
export const PROBE_CACHE_MS = 60_000;

export function summariseProbeError(message: string): ProbeError {
  if (/tls|ssl|certificate/i.test(message)) return 'tls';
  if (/closed|banned|forbidden/i.test(message)) return 'closed';
  if (/timeout|timed out/i.test(message)) return 'timeout';
  return 'refused';
}

/** Terminal events are idempotent: a late close cannot replace an answer. */
export function finishProbe(
  previous: ProbeResult | undefined,
  event: ProbeEvent,
  at: number,
  message = '',
): ProbeResult {
  if (previous) return previous;
  if (event === 'message') return { reachable: true, checkedAt: at };
  return {
    reachable: false,
    checkedAt: at,
    error:
      event === 'error' ? summariseProbeError(message) : event === 'close' ? 'closed' : 'timeout',
  };
}

export function createProbeCache() {
  const entries = new Map<string, ProbeResult>();
  return {
    get(url: string, now = Date.now()) {
      const entry = entries.get(url);
      if (entry && now - entry.checkedAt < PROBE_CACHE_MS) return entry;
      entries.delete(url);
      return undefined;
    },
    set(url: string, result: ProbeResult) {
      entries.delete(url);
      entries.set(url, result);
      if (entries.size > 200) entries.delete(entries.keys().next().value!);
    },
    clear() {
      entries.clear();
    },
  };
}
