/**
 * nostr-tools keys `pool.listConnectionStatus()` by its normalised URL, which
 * adds a trailing slash (`wss://relay.damus.io/`), while the app writes relay
 * URLs without one (`wss://relay.damus.io`). Re-key the map the app's way so a
 * lookup by an app relay URL finds its status (#1147). A path other than `/`
 * is kept as-is.
 */
export function connectionStatusByAppUrl(status: Map<string, boolean>): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const [url, connected] of status) {
    const key = url.replace(/^(wss?:\/\/[^/]+)\/$/i, '$1');
    // Two pool entries for one relay (with and without the slash): either connected wins.
    out.set(key, (out.get(key) ?? false) || connected);
  }
  return out;
}
