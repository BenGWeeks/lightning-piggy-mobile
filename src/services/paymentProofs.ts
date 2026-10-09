// Proof-of-payment memory for our own outgoing Lightning payments.
//
// A successful pay_invoice returns the preimage, and a Lightning payment hash
// is sha256(preimage) — so the preimage is cryptographic proof the payment
// completed. Some NWC backends (notably LNbits) record the outgoing payment
// as `pending` in list_transactions until a background check flips it, which
// left the transaction sheet saying "Pending" right after the success pop-up.
// Holding the proof lets the transaction mapper show such a row as settled
// immediately. Keyed by the hash computed FROM the preimage, so a proof can
// never be attached to the wrong payment.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// v2: proofs are scoped per wallet — a payment hash identifies the invoice,
// not which of our wallets paid it (v1 keyed by hash alone).
const STORAGE_KEY = 'payment_proofs_v2';
const MAX_PROOFS = 200;
const HEX64 = /^[0-9a-f]{64}$/;

// `${walletId}:${paymentHash}` → preimage (insertion order = age). The hash is
// always the trailing 64 hex chars, so a ':' inside a wallet id is harmless.
const proofs = new Map<string, string>();
let hydrated: Promise<boolean> | null = null;

const keyOf = (walletId: string, hash: string) => `${walletId}:${hash}`;

function persist(): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...proofs])).catch(() => undefined);
}

/** Load proofs saved by earlier sessions (idempotent). Stored (older) proofs
 * go first, then any recorded this session, so the cap evicts the oldest.
 * Resolves false if the store couldn't be read — nothing is persisted then
 * (it would overwrite the unread store), and the next call retries. */
export function hydratePaymentProofs(): Promise<boolean> {
  hydrated ??= AsyncStorage.getItem(STORAGE_KEY).then(
    (raw) => {
      // Parse + validate BEFORE touching the map: a corrupt store must never
      // wipe proofs already recorded this session.
      const stored = raw ? parseStoredProofs(raw) : [];
      const thisSession = [...proofs];
      proofs.clear();
      for (const [key, preimage] of stored) proofs.set(key, preimage);
      for (const [key, preimage] of thisSession) {
        proofs.delete(key);
        proofs.set(key, preimage);
      }
      capProofs();
      if (thisSession.length > 0) persist(); // write the merged set
      return true;
    },
    () => {
      hydrated = null; // let the next call retry the read
      return false;
    },
  );
  return hydrated;
}

function parseStoredProofs(raw: string): [string, string][] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Re-derive each hash from its preimage: a tampered pair (valid hex, but
    // the preimage doesn't hash to the key) must never mark a row settled.
    return parsed.filter((e): e is [string, string] => {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || typeof e[1] !== 'string') return false;
      const [key, preimage] = e as [string, string];
      const hash = key.slice(-64);
      return (
        key.length > 65 &&
        key[key.length - 65] === ':' &&
        HEX64.test(hash) &&
        HEX64.test(preimage) &&
        bytesToHex(sha256(hexToBytes(preimage))) === hash
      );
    });
  } catch {
    return [];
  }
}

function capProofs(): void {
  while (proofs.size > MAX_PROOFS) proofs.delete(proofs.keys().next().value as string);
}

/** Record the preimage a CONFIRMED payment from `walletId` returned. Ignores
 * malformed input. */
export function recordPaymentProof(walletId: string, preimage: string | undefined | null): void {
  const p = preimage?.toLowerCase();
  if (!walletId || !p || !HEX64.test(p)) return;
  const key = keyOf(walletId, bytesToHex(sha256(hexToBytes(p))));
  proofs.delete(key);
  proofs.set(key, p);
  capProofs();
  // Persist only after earlier sessions' proofs are loaded — a payment made
  // before the first tx-list fetch would otherwise overwrite them.
  void hydratePaymentProofs().then((ok) => {
    if (ok) persist();
  });
}

/** The preimage proving `walletId` paid `paymentHash`, if we hold one. */
export function getPaymentProof(
  walletId: string | undefined,
  paymentHash: string | undefined | null,
): string | undefined {
  return walletId && paymentHash
    ? proofs.get(keyOf(walletId, paymentHash.toLowerCase()))
    : undefined;
}

/** Test seam. */
export function clearPaymentProofsForTests(): void {
  proofs.clear();
  hydrated = null;
}
