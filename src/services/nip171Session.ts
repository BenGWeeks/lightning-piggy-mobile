import { hexToBytes } from '@noble/hashes/utils.js';
import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import { notifyGroupMessage } from '../contexts/nostrEventBus';
import { appendGroupMessage } from './groupMessagesStorageService';
import { nostrGetEventHash, nostrVerifyEvent } from './nostrCrypto';
import { pool, trackRelays, type RawGiftWrapEvent } from './nostrService';
import { querySyncAbortable } from './relayQuery';
import {
  nip171GroupStates,
  noteNip171Members,
  setNip171GroupMeta,
  subscribeNip171Groups,
  type Nip171GroupState,
} from './nip171Groups';
import { unwrapWrapNsec } from '../utils/nip17Unwrap';
import { classifyGroupRumor, nip171GroupId, type Nip171Event } from '../utils/nip171';

// Live delivery for NIP-171 groups: one bounded subscription for the gift
// wraps addressed to each group's current epoch key, decrypted with that key
// (so it works whatever signer the account uses), validated per the draft,
// and appended to the shared group message log.

/** Recent wraps per epoch key on (re)subscribe. NIP-59 randomises
 * `created_at`, so no `since`: bounded by `limit` instead. */
export const NIP171_WRAP_LIMIT = 128;

// Verify a fresh copy: a memoised result can't vouch for a rebuilt ticket.
const verify = (event: Required<Omit<Nip171Event, 'sealInvitationProof'>>) =>
  nostrVerifyEvent({ ...event } as Parameters<typeof nostrVerifyEvent>[0]);
const hash = (event: Omit<Nip171Event, 'id' | 'sig'>) =>
  nostrGetEventHash(event as Parameters<typeof nostrGetEventHash>[0]);

/** Validate and store one wrap for `state`. Exported for tests. */
export async function ingestNip171Wrap(
  owner: string,
  state: Nip171GroupState,
  wrap: RawGiftWrapEvent,
): Promise<'stored' | 'announcement' | 'invalid'> {
  const rumor = unwrapWrapNsec(wrap, hexToBytes(state.keys.current.epochSecretHex));
  if (!rumor) return 'invalid';
  const verdict = classifyGroupRumor(
    rumor,
    {
      groupPubkey: state.keys.groupPubkey,
      epoch: state.keys.epoch,
      epochPubkey: state.epochPubkey,
      epochSecretHex: state.keys.current.epochSecretHex,
      knownEpochPubkeys: state.epochPubkeys,
    },
    verify,
    hash,
  );
  if (verdict.type === 'invalid') return 'invalid';
  if (verdict.type === 'announcement') {
    noteNip171Members(owner, state.keys.groupPubkey, verdict.members);
    return 'announcement';
  }
  // Text messages for now; files (kind 15) and reactions (kind 7) follow.
  if (rumor.kind !== 14) return 'invalid';
  noteNip171Members(owner, state.keys.groupPubkey, [verdict.sender]);
  const groupId = nip171GroupId(state.keys.groupPubkey);
  await appendGroupMessage(owner, groupId, {
    id: wrap.id,
    senderPubkey: verdict.sender,
    text: rumor.content,
    createdAt: rumor.created_at,
    wireKind: 14,
  });
  notifyGroupMessage(groupId);
  return 'stored';
}

// The group identity's profile (name / picture) and kind-10050 relays.
async function refreshGroupMeta(owner: string, groupPubkey: string, relays: string[]) {
  try {
    const events = await querySyncAbortable(
      pool,
      relays,
      { kinds: [0, 10050], authors: [groupPubkey], limit: 4 },
      { maxWait: 5000 },
    );
    const newest = (kind: number) =>
      events.filter((e) => e.kind === kind).sort((a, b) => b.created_at - a.created_at)[0];
    const profile = newest(0);
    const inbox = newest(10050);
    let name: string | undefined;
    let picture: string | undefined;
    if (profile) {
      try {
        const parsed = JSON.parse(profile.content) as Record<string, unknown>;
        const pick = (k: string) => (typeof parsed[k] === 'string' ? (parsed[k] as string) : '');
        name = (pick('display_name') || pick('name')).trim() || undefined;
        picture = pick('picture').trim() || undefined;
      } catch {
        // A malformed profile leaves the name unset.
      }
    }
    const groupRelays = inbox?.tags
      .filter((t) => t[0] === 'relay' && typeof t[1] === 'string' && /^wss?:\/\//.test(t[1]))
      .map((t) => t[1])
      .slice(0, 8);
    await setNip171GroupMeta(owner, groupPubkey, {
      ...(name ? { name } : {}),
      ...(picture ? { picture } : {}),
      ...(groupRelays?.length ? { relays: groupRelays } : {}),
    });
  } catch {
    // Retried on the next session start.
  }
}

/**
 * Receive the account's NIP-171 group messages until stopped. Re-subscribes
 * when the groups or their epochs change (a new ticket). `readRelays` are the
 * account's own; each group's advertised relays are added.
 */
export function startNip171Session(owner: string, readRelays: string[]): () => void {
  let stopped = false;
  let close: (() => void) | null = null;
  const seen = new Set<string>();
  const queue: RawGiftWrapEvent[] = [];
  let draining = false;
  const metaFetched = new Set<string>();

  const drain = async () => {
    if (draining) return;
    draining = true;
    const scheduler = createYieldScheduler({ safetyEvery: 8 });
    try {
      while (queue.length && !stopped) {
        await scheduler.maybeYield();
        const wrap = queue.shift()!;
        const target = wrap.tags.find((t) => t[0] === 'p')?.[1];
        const state = [...nip171GroupStates(owner).values()].find((s) => s.epochPubkey === target);
        if (!state) continue;
        try {
          await ingestNip171Wrap(owner, state, wrap);
        } catch (e) {
          if (__DEV__) console.warn('[NIP-171] wrap ingest failed:', e);
        }
      }
    } finally {
      scheduler.dispose();
      draining = false;
    }
  };

  const subscribe = () => {
    close?.();
    close = null;
    if (stopped) return;
    const groups = [...nip171GroupStates(owner).values()];
    if (groups.length === 0) return;
    const relays = [...new Set([...readRelays, ...groups.flatMap((g) => g.meta.relays ?? [])])];
    if (relays.length === 0) return;
    trackRelays(relays);
    for (const g of groups) {
      if (metaFetched.has(g.keys.groupPubkey)) continue;
      metaFetched.add(g.keys.groupPubkey);
      void refreshGroupMeta(owner, g.keys.groupPubkey, relays);
    }
    if (__DEV__) {
      console.log(`[NIP-171] session: ${groups.length} group(s) on ${relays.length} relays`);
    }
    const filter = {
      kinds: [1059],
      '#p': groups.map((g) => g.epochPubkey),
      limit: NIP171_WRAP_LIMIT * groups.length,
    };
    const sub = pool.subscribeMap(
      relays.map((url) => ({ url, filter })),
      {
        onevent: (event: RawGiftWrapEvent) => {
          if (seen.has(event.id)) return;
          seen.add(event.id);
          queue.push(event);
          void drain();
        },
      },
    );
    close = () => sub.close();
  };

  // A new ticket (join or epoch rotation) changes the keys to listen on.
  let key = '';
  const unsubscribe = subscribeNip171Groups((changed) => {
    if (changed !== owner || stopped) return;
    const next = [...nip171GroupStates(owner).values()]
      .map((g) => `${g.epochPubkey}:${(g.meta.relays ?? []).join(',')}`)
      .sort()
      .join('|');
    if (next === key) return;
    key = next;
    subscribe();
  });
  key = [...nip171GroupStates(owner).values()]
    .map((g) => `${g.epochPubkey}:${(g.meta.relays ?? []).join(',')}`)
    .sort()
    .join('|');
  subscribe();

  return () => {
    stopped = true;
    unsubscribe();
    close?.();
    close = null;
    queue.length = 0;
  };
}
