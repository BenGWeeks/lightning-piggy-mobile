import type { VerifiedEvent } from 'nostr-tools/pure';
import { nostrFinalizeEvent } from './nostrCrypto';
import { pool, trackRelays } from './nostrPool';
import { requireRelayAcknowledgement } from '../utils/relayPublishResult';

export async function signAndPublishEvent(
  event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  },
  secretKey: Uint8Array,
  relays: string[],
): Promise<void> {
  trackRelays(relays);
  const signed = nostrFinalizeEvent(event, secretKey);
  await Promise.any(pool.publish(relays, signed).map((p) => p.then(requireRelayAcknowledgement)));
}

export async function publishSignedEvent(
  signedEvent: {
    id: string;
    pubkey: string;
    sig: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  },
  relays: string[],
): Promise<void> {
  trackRelays(relays);
  await Promise.any(
    pool
      .publish(relays, signedEvent as VerifiedEvent)
      .map((p) => p.then(requireRelayAcknowledgement)),
  );
}
