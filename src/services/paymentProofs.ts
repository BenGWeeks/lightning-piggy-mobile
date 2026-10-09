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

const STORAGE_KEY = 'payment_proofs_v1';
const MAX_PROOFS = 200;
const HEX64 = /^[0-9a-f]{64}$/;

const proofs = new Map<string, string>(); // payment hash → preimage (insertion order = age)
let hydrated: Promise<void> | null = null;

function persist(): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...proofs])).catch(() => undefined);
}

/** Load proofs saved by earlier sessions (idempotent). Stored (older) proofs
 * go first, then any recorded this session, so the cap evicts the oldest. */
export function hydratePaymentProofs(): Promise<void> {
  hydrated ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      // Parse + validate BEFORE touching the map: a corrupt store must never
      // wipe proofs already recorded this session.
      const stored = parseStoredProofs(raw);
      const thisSession = [...proofs];
      proofs.clear();
      for (const [hash, preimage] of stored) proofs.set(hash, preimage);
      for (const [hash, preimage] of thisSession) {
        proofs.delete(hash);
        proofs.set(hash, preimage);
      }
      capProofs();
    })
    .catch(() => undefined);
  return hydrated;
}

function parseStoredProofs(raw: string): [string, string][] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is [string, string] =>
        Array.isArray(e) && HEX64.test(String(e[0])) && HEX64.test(String(e[1])),
    );
  } catch {
    return [];
  }
}

function capProofs(): void {
  while (proofs.size > MAX_PROOFS) proofs.delete(proofs.keys().next().value as string);
}

/** Record the preimage a successful payment returned. Ignores malformed input. */
export function recordPaymentProof(preimage: string | undefined | null): void {
  const p = preimage?.toLowerCase();
  if (!p || !HEX64.test(p)) return;
  const hash = bytesToHex(sha256(hexToBytes(p)));
  proofs.delete(hash);
  proofs.set(hash, p);
  capProofs();
  // Persist only after earlier sessions' proofs are loaded — a payment made
  // before the first tx-list fetch would otherwise overwrite them.
  void hydratePaymentProofs().then(persist);
}

/** The preimage proving `paymentHash` was paid by us, if we hold one. */
export function getPaymentProof(paymentHash: string | undefined | null): string | undefined {
  return paymentHash ? proofs.get(paymentHash.toLowerCase()) : undefined;
}

/** Test seam. */
export function clearPaymentProofsForTests(): void {
  proofs.clear();
  hydrated = null;
}
