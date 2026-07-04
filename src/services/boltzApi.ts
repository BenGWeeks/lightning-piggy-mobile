// Low-level Boltz HTTP transport shared by boltzService and boltzSwapStatus.
// Kept as a leaf module (no imports from either of those) so the status layer
// can reuse the timeout-aware fetch without creating an import cycle.

/** Base URL for the Boltz Exchange v2 API. */
export const BOLTZ_API = 'https://api.boltz.exchange/v2';

/** Fetch with a timeout to prevent hanging on slow/unreachable APIs.
 * Exported for swapRecoveryService — its recovery pass is single-flight, so
 * one bare `fetch` hanging there used to block every future recovery trigger
 * for the whole session (swap audit finding, 2026-07-02). */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Honour an external signal passed via `init.signal` — link it to the
  // internal controller so a caller-driven cancel aborts the in-flight fetch
  // too, not just the internal timeout. (Without this the internal signal
  // would silently override the caller's.)
  const external = init?.signal ?? undefined;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}
