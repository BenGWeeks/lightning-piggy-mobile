import { npubEncode } from 'nostr-tools/nip19';
import { fetchProfilesBatch } from './nostrProfileBatch';
import { PROFILE_RELAYS } from './nostrRelayDefaults';
import * as profileCache from './zapSenderProfileStorage';
import { parseProfileContent } from '../utils/profileContent';
import { slimDisplayProfile } from '../utils/profileSanitize';
import { isPublicRelayUrl } from '../utils/publicUrl';
import type { NostrProfile } from '../types/nostr';
import type { SharedContactRef } from '../utils/messageContent';

export const SHARED_PROFILE_BATCH_SIZE = 50;
export const SHARED_PROFILE_TIMEOUT_MS = 10000;

/** Verified resolution with display-cache fallback. Each bounded batch finishes
 * even if storage or a relay stalls; null is a completed miss, never pending.
 * onProfile exposes partial results for a caller's earlier scheduling deadline;
 * callers should buffer them rather than update React state per relay event. */
export async function resolveSharedContactProfiles(
  refs: readonly SharedContactRef[],
  onProfile?: (pubkey: string, profile: NostrProfile) => void,
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
      const displayProfile = slimDisplayProfile({
        ...parseProfileContent('{}'),
        ...profile,
        pubkey: pk,
        npub: npubEncode(pk),
      });
      updates[pk] = displayProfile;
      onProfile?.(pk, displayProfile);
    }
    // The display cache has no verified payment address. Refresh even cache
    // hits so shared-card taps retain Zap eligibility without trusting storage.
    const hints = [...new Set(batch.flatMap((ref) => ref.relays).filter(isPublicRelayUrl))].slice(
      0,
      5,
    );
    const relays = [...new Set([...PROFILE_RELAYS, ...hints])];
    await fetchProfilesBatch(
      batch.map((ref) => ref.pubkey),
      relays,
      8000,
      (event) => {
        if (finished) return;
        const profile: NostrProfile = {
          ...parseProfileContent(event.content),
          pubkey: event.pubkey,
          npub: npubEncode(event.pubkey),
        };
        updates[event.pubkey] = profile;
        onProfile?.(event.pubkey, profile);
      },
      true,
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
