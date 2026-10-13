import { npubEncode } from 'nostr-tools/nip19';
import { fetchProfilesBatch } from './nostrProfileBatch';
import { PROFILE_RELAYS } from './nostrRelayDefaults';
import * as profileCache from './zapSenderProfileStorage';
import { parseProfileContent } from '../utils/profileContent';
import { slimDisplayProfile } from '../utils/profileSanitize';
import type { NostrProfile } from '../types/nostr';
import type { SharedContactRef } from '../utils/messageContent';

export const SHARED_PROFILE_BATCH_SIZE = 50;
export const SHARED_PROFILE_TIMEOUT_MS = 10000;

/** Display-only resolution. Each bounded batch finishes even if storage or a
 * relay stalls; null is a completed miss, never a pending loading state. */
export async function resolveSharedContactProfiles(
  refs: readonly SharedContactRef[],
): Promise<Record<string, NostrProfile | null>> {
  const batch = refs.slice(0, SHARED_PROFILE_BATCH_SIZE);
  const updates: Record<string, NostrProfile | null> = {};
  for (const ref of batch) updates[ref.pubkey] = null;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    const cached = await profileCache
      .getMany(batch.map((ref) => ref.pubkey))
      .catch(() => new Map<string, profileCache.CachedZapSenderProfile>());
    if (finished) return;
    for (const [pk, profile] of cached) {
      updates[pk] = { ...parseProfileContent('{}'), ...profile, pubkey: pk, npub: npubEncode(pk) };
    }
    const missing = batch.filter((ref) => !updates[ref.pubkey]);
    if (missing.length === 0) return;
    const relays = [...new Set([...PROFILE_RELAYS, ...missing.flatMap((ref) => ref.relays)])];
    await fetchProfilesBatch(
      missing.map((ref) => ref.pubkey),
      relays,
      8000,
      (event) => {
        if (finished) return;
        updates[event.pubkey] = slimDisplayProfile({
          ...parseProfileContent(event.content),
          pubkey: event.pubkey,
          npub: npubEncode(event.pubkey),
        });
      },
    );
  };
  try {
    await Promise.race([
      work().catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHARED_PROFILE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    finished = true;
    if (timer !== undefined) clearTimeout(timer);
  }
  return updates;
}
