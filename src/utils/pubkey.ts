// Shared pubkey validation. A well-formed Nostr pubkey is exactly 64
// lowercase hex characters. Several surfaces (DM unwrap, group rosters,
// the Friends/contacts list) need the same gate to keep malformed values
// — most visibly zero-prefixed all-junk strings like `000000001c5c…` from
// a corrupt kind-3 follow list — out of the UI (#855).
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * True when `value` is a canonical 64-char lowercase-hex pubkey. Rejects
 * null/undefined, non-strings, wrong-length, non-hex, and mixed/upper-case
 * (callers that want to accept mixed case should `normalizePubkey` first).
 */
export function isHex64Pubkey(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value);
}

/**
 * Lowercase + validate a candidate pubkey, returning the canonical
 * lowercase form, or null if it isn't a 64-hex pubkey. Use at ingest
 * boundaries to both normalise case and drop junk in one step.
 */
export function normalizePubkey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  return HEX64.test(lower) ? lower : null;
}
