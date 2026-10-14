// Per-message photo / voice-note file keys (MIP-04), kept in the account's
// Marmot KV store under `mediaKeys:<group id hex>` → rumor id.
//
// A file key comes from the epoch the message was sent in, and retained
// epochs are pruned as the group moves on — so a key is derived once and
// kept: the startup history replay re-delivers old messages after their
// epoch may be gone, and must not replace a stored key with one that can no
// longer decrypt the file.

import { deriveMediaKeys, isMediaKeys, type MarmotMediaKeys } from './marmotMedia';
import type { MarmotKvBackend } from './marmotStore';

type DeriveArgs = Parameters<typeof deriveMediaKeys>;
const namespace = (groupIdHex: string) => `mediaKeys:${groupIdHex}`;

/** The group fields deriving a key needs. */
export interface MediaKeyGroup {
  idStr: string;
  ciphersuite: DeriveArgs[1];
  mediaService: { mediaPolicy: DeriveArgs[2] };
}

/** Record the keys of a message we're sending, so its replay reads back the same. */
export function rememberMediaKeys(
  backend: Pick<MarmotKvBackend, 'set'>,
  groupIdHex: string,
  rumorId: string,
  keys: MarmotMediaKeys,
): Promise<void> {
  return backend.set(namespace(groupIdHex), rumorId, JSON.stringify(keys));
}

/** Drop a pruned message's keys. */
export function forgetMediaKeys(
  backend: Pick<MarmotKvBackend, 'remove'>,
  groupIdHex: string,
  rumorId: string,
): Promise<void> {
  return backend.remove(namespace(groupIdHex), rumorId);
}

/** The message's stored keys, else derived from `states` and stored. */
export async function loadOrDeriveMediaKeys(
  backend: Pick<MarmotKvBackend, 'get' | 'set'>,
  g: MediaKeyGroup,
  rumor: { id: string; tags: string[][] },
  states: DeriveArgs[0],
): Promise<MarmotMediaKeys | undefined> {
  const ns = namespace(g.idStr);
  try {
    const saved = await backend.get(ns, rumor.id);
    // Only trust a saved entry in the current shape; anything else (an
    // older dev build's format) is re-derived rather than read as empty.
    const parsed = saved ? (JSON.parse(saved) as unknown) : null;
    if (isMediaKeys(parsed)) return parsed;
    const keys = await deriveMediaKeys(
      states,
      g.ciphersuite,
      g.mediaService.mediaPolicy,
      rumor.tags,
    );
    await backend.set(ns, rumor.id, JSON.stringify(keys));
    return keys;
  } catch (e) {
    if (__DEV__) console.warn('[Marmot] media key derivation failed:', e);
    return undefined;
  }
}
