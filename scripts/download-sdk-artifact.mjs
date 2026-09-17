// A total deadline covers headers and the complete body, including slow-drip
// responses that never exceed the HTTP client's per-chunk inactivity timeout.
export async function downloadArtifact(url, timeoutMs = 300_000) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'follow', signal });
    if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`GET ${url} timed out after ${timeoutMs} ms`, { cause: error });
    }
    throw error;
  }
}
