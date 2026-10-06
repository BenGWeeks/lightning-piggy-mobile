import type { UnsignedEvent } from './relayListEvents';

/** BUD-03 user server list (#1149): `["server", url]` tags, primary first. */
export const BLOSSOM_SERVER_LIST_KIND = 10063;

/** An https Blossom server URL, without a trailing slash; null if invalid. */
export function normalizeBlossomServer(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, '');
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' || !u.hostname) return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function buildBlossomServerListEvent(servers: string[], now = Date.now()): UnsignedEvent {
  const tags = [
    ...new Set(servers.map(normalizeBlossomServer).filter((u): u is string => !!u)),
  ].map((url) => ['server', url]);
  return { kind: BLOSSOM_SERVER_LIST_KIND, created_at: Math.floor(now / 1000), tags, content: '' };
}

/** Servers from a kind-10063 event's tags, in order; invalid ones dropped. */
export function blossomServersFromTags(tags: string[][]): string[] {
  return [
    ...new Set(
      tags
        .filter((t) => t[0] === 'server' && t[1])
        .map((t) => normalizeBlossomServer(t[1]))
        .filter((u): u is string => !!u),
    ),
  ];
}
