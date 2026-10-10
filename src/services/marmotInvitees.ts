// Which of a contact's devices to invite into a Marmot group, and the ONE
// Add commit that brings every one of them in.
//
// A person with several installs (Lightning Piggy on two phones, White Noise
// as well) publishes one key package per install: kind 30443, each in its own
// `d` slot. Inviting just one of them puts the chat on whichever install that
// key belongs to and the person's other apps never see it. So we invite all
// of their fresh devices in a single commit — one Welcome, every device joins.
// The MLS tree then holds several leaves for one account; everything above
// the session (member lists, DM detection, attribution) counts ACCOUNTS —
// `getGroupMembers` returns distinct credential pubkeys, and marmot-ts binds
// every app event's `pubkey` to its sender leaf's account.
//
// Only the PEER's devices: our own other installs are never added here (that
// would be device linking, MIP-06 — not specified yet).

import {
  createInviteIntent,
  evaluateKeyPackageForGroup,
  getCredentialPubkey,
  getKeyPackage,
  type GroupPublishResult,
  type MarmotClient,
  type MarmotGroup,
  type NostrNetworkInterface,
} from '@internet-privacy/marmot-ts';
import type { Event as NostrEvent } from 'nostr-tools';

import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import { relayListFromTags } from '../utils/relayListEvents';
import {
  isUsableKeyPackage,
  MarmotNoKeyPackageError,
  MarmotUnusableKeyPackageError,
  newestEvent,
} from './marmotKeyPackages';

const KEY_PACKAGE_KIND = 30443;
/** A slot not refreshed for this long is treated as an abandoned install. */
export const DEVICE_MAX_AGE_SECS = 30 * 24 * 60 * 60;
/** At most this many devices per person (newest first) — bounds the commit. */
export const MAX_DEVICES_PER_PERSON = 10;
/** Per-relay cap on a peer's key-package query (newest per slot is kept). */
const KEY_PACKAGE_QUERY_LIMIT = 50;

type CommitIntent = ReturnType<typeof createInviteIntent>;
type Yield = () => Promise<void> | void;

/**
 * A peer's kind-30443 events from the write relays of their NEWEST kind-10002
 * (lookup relays can lag, #1202) plus our lookup relays. Bounded: `limit` on
 * both filters, and the network resolves each request on EOSE or timeout.
 */
export async function fetchKeyPackageEvents(
  network: Pick<NostrNetworkInterface, 'request'>,
  lookupRelays: string[],
  peer: string,
): Promise<NostrEvent[]> {
  const author = peer.toLowerCase();
  const relayList = newestEvent(
    (await network.request(lookupRelays, {
      kinds: [10002],
      authors: [author],
      limit: 1,
    })) as NostrEvent[],
  );
  const writeSet = relayList
    ? relayListFromTags(relayList.tags)
        .filter((r) => r.write)
        .map((r) => r.url)
    : [];
  return (await network.request([...new Set([...writeSet, ...lookupRelays])], {
    kinds: [KEY_PACKAGE_KIND],
    authors: [author],
    limit: KEY_PACKAGE_QUERY_LIMIT,
  })) as NostrEvent[];
}

/** Signature, tags, lifetime (isUsableKeyPackage) + credential = author. */
function isValidDeviceKeyPackage(e: NostrEvent, peer: string, nowSecs: number): boolean {
  if (e.kind !== KEY_PACKAGE_KIND || e.pubkey.toLowerCase() !== peer) return false;
  if (!isUsableKeyPackage(e, nowSecs)) return false;
  try {
    return getCredentialPubkey(getKeyPackage(e).leafNode.credential).toLowerCase() === peer;
  } catch {
    return false; // undecodable KeyPackage
  }
}

/**
 * The key packages to invite `peer` with — one per device: the newest event
 * per `d` slot, valid, published within 30 days, newest first, at most 10.
 * If no slot is that fresh, the newest valid one is still used (a contact
 * whose only install hasn't refreshed lately must stay reachable).
 * Returns [] when they published none; throws when none is usable.
 */
export async function selectDeviceKeyPackages(
  peer: string,
  events: NostrEvent[],
  opts: { nowSecs?: number; yieldNow?: Yield } = {},
): Promise<NostrEvent[]> {
  const p = peer.toLowerCase();
  const nowSecs = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const newestPerSlot = new Map<string, NostrEvent>();
  for (const e of events) {
    if (e.kind !== KEY_PACKAGE_KIND || e.pubkey.toLowerCase() !== p) continue;
    const slot = e.tags.find((t) => t[0] === 'd')?.[1] ?? e.id;
    const prev = newestPerSlot.get(slot);
    if (!prev || e.created_at > prev.created_at) newestPerSlot.set(slot, e);
  }
  const candidates = [...newestPerSlot.values()].sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
  );
  const valid: NostrEvent[] = [];
  for (const e of candidates) {
    // Signature checks are pure-JS crypto: hand the thread back between them.
    await opts.yieldNow?.();
    if (isValidDeviceKeyPackage(e, p, nowSecs)) valid.push(e);
  }
  if (valid.length === 0) {
    if (candidates.length > 0) throw new MarmotUnusableKeyPackageError(peer);
    return [];
  }
  const fresh = valid.filter((e) => e.created_at >= nowSecs - DEVICE_MAX_AGE_SECS);
  return (fresh.length > 0 ? fresh : valid.slice(0, 1)).slice(0, MAX_DEVICES_PER_PERSON);
}

export interface InviteBatch {
  /** One commit adding every reachable device; null if nobody is reachable. */
  intent: CommitIntent | null;
  /** Person → number of their devices in the commit. */
  devices: Map<string, number>;
  /** People none of whose devices can join this group. */
  unreachable: string[];
}

/**
 * Merge every device's Add into one commit. A key package the group can't
 * take (cipher suite, required capabilities, the library's own invite checks)
 * is skipped and logged — the person's other devices still join.
 */
export function buildInviteBatch(
  state: MarmotGroup['state'],
  actorPubkey: string,
  devicesByPerson: Map<string, NostrEvent[]>,
): InviteBatch {
  const extraProposals: NonNullable<CommitIntent['extraProposals']> = [];
  const welcomeRecipients: NonNullable<CommitIntent['welcomeRecipients']> = [];
  const devices = new Map<string, number>();
  const unreachable: string[] = [];
  for (const [person, keyPackages] of devicesByPerson) {
    let added = 0;
    for (const kp of keyPackages) {
      const verdict = evaluateKeyPackageForGroup(state, kp);
      if (!verdict.eligible) {
        if (__DEV__) {
          console.warn(`[Marmot] skipping key package ${kp.id.slice(0, 12)}:`, verdict.reasons);
        }
        continue;
      }
      try {
        const intent = createInviteIntent({ keyPackageEvent: kp, actorPubkey });
        extraProposals.push(...(intent.extraProposals ?? []));
        welcomeRecipients.push(...(intent.welcomeRecipients ?? []));
        added++;
      } catch (e) {
        if (__DEV__) console.warn(`[Marmot] skipping key package ${kp.id.slice(0, 12)}:`, e);
      }
    }
    if (added > 0) devices.set(person, added);
    else unreachable.push(person);
  }
  return {
    intent:
      welcomeRecipients.length > 0
        ? { kind: 'commit', actorPubkey, extraProposals, welcomeRecipients }
        : null,
    devices,
    unreachable,
  };
}

/** Every Welcome in the commit failed to publish — nobody can join. */
export class MarmotWelcomeDeliveryError extends Error {
  constructor(readonly failed: number) {
    super(`Could not deliver any of ${failed} Marmot invitation(s)`);
    this.name = 'MarmotWelcomeDeliveryError';
  }
}

/**
 * Check the commit's Welcome fan-out. Some devices missing their Welcome is
 * fine (the others joined; logged). Throws only when every one failed.
 */
export function checkWelcomeDelivery(results: GroupPublishResult[]): void {
  const outcomes = results.flatMap((r) =>
    r.welcomeDelivery.kind === 'attempted' ? r.welcomeDelivery.outcomes : [],
  );
  const failed = outcomes.filter((o) => o.kind === 'failed');
  if (failed.length === 0) return;
  if (__DEV__) {
    for (const o of failed) {
      console.warn(
        `[Marmot] Welcome to ${o.recipient.pubkey.slice(0, 8)} (key package ${o.recipient.keyPackageEventId.slice(0, 12)}) failed: ${o.error}`,
      );
    }
  }
  if (failed.length === outcomes.length) throw new MarmotWelcomeDeliveryError(failed.length);
}

/** The peer's fresh, valid key packages — one per device. */
export async function fetchDevices(
  network: Pick<NostrNetworkInterface, 'request'>,
  lookupRelays: string[],
  peer: string,
): Promise<NostrEvent[]> {
  const events = await fetchKeyPackageEvents(network, lookupRelays, peer);
  const scheduler = createYieldScheduler({ safetyEvery: 4 });
  try {
    return await selectDeviceKeyPackages(peer, events, { yieldNow: scheduler.maybeYield });
  } finally {
    scheduler.dispose();
  }
}

/**
 * Every invitee's devices, keyed by account. Peers only — our own pubkey is
 * dropped (never invite our other installs). Throws for anyone with none.
 */
export async function resolveInvitees(
  network: Pick<NostrNetworkInterface, 'request'>,
  lookupRelays: string[],
  self: string,
  members: string[],
): Promise<Map<string, NostrEvent[]>> {
  const me = self.toLowerCase();
  const peers = [...new Set(members.map((m) => m.toLowerCase()))].filter((m) => m !== me);
  const lists = await Promise.all(peers.map((p) => fetchDevices(network, lookupRelays, p)));
  peers.forEach((p, i) => {
    if (lists[i].length === 0) throw new MarmotNoKeyPackageError(p);
  });
  return new Map(peers.map((p, i) => [p, lists[i]]));
}

/** Add every device in ONE commit (one Welcome) so each of them joins. */
export async function inviteDevices(
  groups: Pick<MarmotClient['groups'], 'get' | 'send'>,
  mlsId: string,
  actorPubkey: string,
  devices: Map<string, NostrEvent[]>,
): Promise<void> {
  const group = await groups.get(mlsId);
  const batch = buildInviteBatch(group.state, actorPubkey, devices);
  if (batch.unreachable.length > 0 || !batch.intent) {
    throw new MarmotUnusableKeyPackageError(batch.unreachable[0] ?? '');
  }
  checkWelcomeDelivery(await groups.send(mlsId, batch.intent));
  if (__DEV__) {
    const counts = [...batch.devices].map(([p, n]) => `${p.slice(0, 8)}×${n}`).join(', ');
    console.log(`[Marmot] invited ${counts} into ${mlsId.slice(0, 8)}`);
  }
}
