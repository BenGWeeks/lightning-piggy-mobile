import { fetchRelayInformation, type RelayInformation } from './relayInformation';

/** Verified 2026-10-13: https://github.com/pablof7z/purplepag.es#features
 * user.kindpag.es NIP-11 description: “Stores kind 0, 3 and 10002 events.”
 * Conservative subset needed by this app; unknown relays remain unrestricted.
 */
const NOTES = new Map<string, number[]>([
  ['user.kindpag.es', [0, 3, 10002]],
  ['purplepag.es', [0, 3, 10002, 10050, 10063]],
]);
export function relayAcceptedKinds(url: string, info: RelayInformation | null) {
  if (info?.limitation.allowed_kinds !== undefined)
    return { kinds: info.limitation.allowed_kinds, source: 'nip11' as const };
  try {
    const u = new URL(url);
    const kinds = u.pathname === '/' && !u.port ? NOTES.get(u.hostname.toLowerCase()) : undefined;
    return kinds ? { kinds, source: 'notes' as const } : null;
  } catch {
    return null;
  }
}
export async function relayAllowsKind(url: string, kind: number): Promise<boolean> {
  const info = await fetchRelayInformation(url);
  const accepted = relayAcceptedKinds(url, info);
  return !accepted || accepted.kinds.includes(kind);
}

export const COMMON_KIND_NAMES: Record<number, string> = {
  0: 'profiles',
  1: 'posts',
  3: 'follows',
  4: 'legacyMessages',
  5: 'deletions',
  7: 'reactions',
  1059: 'privateMessages',
  10002: 'relayLists',
  10050: 'inboxRelays',
  10051: 'keyPackageRelays',
  10063: 'storageServers',
};
