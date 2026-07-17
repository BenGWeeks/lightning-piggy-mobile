import { nostrGetEventHash } from './nostrCrypto';

// The unsigned NIP-17 rumor shape whose id we hash. Always carries the sender
// `pubkey`, so the hash matches both send paths (nsec: pubkey ===
// getPublicKey(secretKey); signer: the rumor is built with pubkey set).
export interface DmRumor {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  pubkey: string;
}

/**
 * Stable rumor event id for a NIP-17 DM (#857). This is the id the relay echo
 * carries on the decrypted inner event, so the optimistic-send flow keys its
 * delivery-status store by it — surviving the `local-` → echo row swap and the
 * ~10s re-fetch. Delegates to `nostrCrypto` (the crypto facade), which keeps
 * this file decoupled from the heavy `nostrService` graph.
 */
export function directMessageRumorEventId(rumor: DmRumor): string {
  return nostrGetEventHash(rumor);
}
