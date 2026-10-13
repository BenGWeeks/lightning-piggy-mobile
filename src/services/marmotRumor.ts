import { getEventHash } from 'nostr-tools';
import type { MarmotRumor } from './marmotSession';

/** Build an unsigned app event (Marmot app payloads are never signed). */
export function buildMarmotRumor(
  pubkey: string,
  draft: { kind: number; content: string; tags?: string[][]; created_at?: number },
): MarmotRumor {
  const unsigned = {
    pubkey,
    kind: draft.kind,
    content: draft.content,
    tags: draft.tags ?? [],
    created_at: draft.created_at ?? Math.floor(Date.now() / 1000),
  };
  return { ...unsigned, id: getEventHash(unsigned) };
}
