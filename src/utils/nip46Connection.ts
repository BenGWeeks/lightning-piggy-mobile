import type { Nip46Connection } from '../types/nostr';

/**
 * Runtime shape guard for a persisted `Nip46Connection` blob. SecureStore
 * can hold a partially-written or hand-edited value; a bare `JSON.parse` cast
 * would happily accept `{}`. Require every field the BunkerSigner actually
 * needs so a malformed blob is rejected up front instead of installing an
 * all-undefined connection.
 */
// 32-byte hex (pubkeys, secret keys) — validate the actual encoding so a
// corrupted value like `{ clientSecretKeyHex: "zz" }` is rejected here
// rather than blowing up later in `hexToBytes`/`BunkerSigner`.
const HEX_64 = /^[0-9a-f]{64}$/i;

export function isValidNip46Connection(v: unknown): v is Nip46Connection {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.remoteSignerPubkey === 'string' &&
    HEX_64.test(c.remoteSignerPubkey) &&
    typeof c.userPubkey === 'string' &&
    HEX_64.test(c.userPubkey) &&
    typeof c.clientSecretKeyHex === 'string' &&
    HEX_64.test(c.clientSecretKeyHex) &&
    // `perms` is a (possibly empty) comma-separated string persisted with the
    // connection and compared by `setActiveConnection` — require the field to
    // be a string so a blob missing it doesn't produce `undefined` mismatches.
    typeof c.perms === 'string' &&
    Array.isArray(c.relays) &&
    c.relays.length > 0 &&
    c.relays.every((r) => typeof r === 'string' && r.length > 0)
  );
}
