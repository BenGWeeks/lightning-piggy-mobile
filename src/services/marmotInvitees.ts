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
// would be device linking, MIP-06 — not specified yet). One exception for
// 1:1s with White Noise users — see devicesForDm.

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
  newestKeyPackagePerSlot,
} from './marmotKeyPackages';
import { advertisesMediaV2 } from './marmotKeyPackageLifecycle';
import type { MarmotWelcomeOutbox } from './marmotWelcomeOutbox';

const KEY_PACKAGE_KIND = 30443;
const DAY_SECS = 24 * 60 * 60;
/**
 * A slot not refreshed within this long is treated as an abandoned install.
 * Per client, from how often each one republishes: White Noise rotates at 30
 * days; Lightning Piggy refreshes weekly (14 = two missed refreshes), and
 * untagged slots get the same short window. Each invited device costs the
 * user's signer two operations (seal + encryption) — a dead install is a
 * wasted Amber / NIP-46 approval.
 */
export const WHITE_NOISE_MAX_AGE_SECS = 35 * DAY_SECS;
export const DEVICE_MAX_AGE_SECS = 14 * DAY_SECS;
/** At most this many devices per person (newest first) — bounds the commit. */
export const MAX_DEVICES_PER_PERSON = 10;
/** Per-relay cap on a peer's key-package query (newest per slot is kept). */
const KEY_PACKAGE_QUERY_LIMIT = 50;
const WHITE_NOISE_CLIENT = /white\s*noise/i;
const isWhiteNoise = (e: NostrEvent) =>
  e.tags.some((t) => t[0] === 'client' && WHITE_NOISE_CLIENT.test(t[1] ?? ''));
const maxAgeFor = (e: NostrEvent) =>
  isWhiteNoise(e) ? WHITE_NOISE_MAX_AGE_SECS : DEVICE_MAX_AGE_SECS;

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
 * per `d` slot (retired slots skipped), valid, compatible (media v2),
 * recently refreshed for its client (maxAgeFor), newest first. If none
 * qualifies, the newest compatible (else newest valid) one is still used —
 * a contact whose only install is old or quiet must stay reachable. The per-person cap is applied once each key
 * is checked against the group (buildInviteBatch), so a rejected one makes
 * room for the next. Returns [] when they published none (or only retired
 * slots); throws when none is usable.
 */
export async function selectDeviceKeyPackages(
  peer: string,
  events: NostrEvent[],
  opts: { nowSecs?: number; yieldNow?: Yield } = {},
): Promise<NostrEvent[]> {
  const p = peer.toLowerCase();
  const nowSecs = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const candidates = newestKeyPackagePerSlot(
    events.filter((e) => e.kind === KEY_PACKAGE_KIND && e.pubkey.toLowerCase() === p),
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
  // Compatible = advertises encrypted media v2 (0x800b). White Noise requires
  // it of EVERY member and silently drops a Welcome whose tree holds one leaf
  // without it — so one outdated install would hide the chat from all of the
  // group's White Noise users (seen on device with old Marmot test installs).
  const compatible = valid.filter((e) => advertisesMediaV2([e]));
  const fresh = compatible.filter((e) => e.created_at >= nowSecs - maxAgeFor(e));
  return fresh.length > 0 ? fresh : [compatible[0] ?? valid[0]];
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
      if (added >= MAX_DEVICES_PER_PERSON) break;
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

/** No invited person's Welcome reached a relay — nobody can join. */
export class MarmotWelcomeDeliveryError extends Error {
  constructor(readonly people: string[]) {
    super(`Could not deliver the Marmot invitation to ${people.length} person(s)`);
    this.name = 'MarmotWelcomeDeliveryError';
  }
}

/** People with at least one device whose Welcome a relay accepted. */
export function deliveredAccounts(results: GroupPublishResult[]): Set<string> {
  const delivered = new Set<string>();
  for (const r of results) {
    if (r.welcomeDelivery.kind !== 'attempted') continue;
    for (const o of r.welcomeDelivery.outcomes) {
      if (o.kind === 'succeeded') delivered.add(o.recipient.pubkey.toLowerCase());
      else if (__DEV__) {
        console.warn(
          `[Marmot] Welcome to ${o.recipient.pubkey.slice(0, 8)} (key package ${o.recipient.keyPackageEventId.slice(0, 12)}) failed: ${o.error}`,
        );
      }
    }
  }
  return delivered;
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
 * The devices to put in a 1:1. White Noise (MDK 0.12) decides "is this a DM"
 * by counting LEAVES — an unnamed group with exactly two — so a DM holding
 * two of a White Noise user's devices would show up there as a group, and
 * White Noise's own "message" button would start a second chat. White Noise
 * is also single-device by design and invites one key package per person,
 * preferring its own newest. So for a contact with a White Noise install we
 * do the same: their newest White Noise key package only. Contacts on other
 * clients (Lightning Piggy on two phones) get every device. Groups always do.
 */
export function devicesForDm(devices: NostrEvent[]): NostrEvent[] {
  const whiteNoise = devices.find(isWhiteNoise);
  return whiteNoise ? [whiteNoise] : devices;
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
  opts: { dm?: boolean } = {},
): Promise<Map<string, NostrEvent[]>> {
  const me = self.toLowerCase();
  const peers = [...new Set(members.map((m) => m.toLowerCase()))].filter((m) => m !== me);
  const lists = await Promise.all(peers.map((p) => fetchDevices(network, lookupRelays, p)));
  peers.forEach((p, i) => {
    if (lists[i].length === 0) throw new MarmotNoKeyPackageError(p);
  });
  return new Map(peers.map((p, i) => [p, opts.dm ? devicesForDm(lists[i]) : lists[i]]));
}

export interface InviteResult {
  /** People none of whose devices got their Welcome yet (queued for retry). */
  undelivered: string[];
}

/**
 * Add every device in ONE commit (one Welcome) so each of them joins. A
 * Welcome no relay accepted is republished once straight away and then kept
 * in the outbox for retry — no second Add commit, no new signer prompt.
 * `onProgress` ticks as each device's Welcome is sent (with Amber / NIP-46
 * each one is an approval).
 */
export async function inviteDevices(
  groups: Pick<MarmotClient['groups'], 'get' | 'send'>,
  outbox: Pick<MarmotWelcomeOutbox, 'capture' | 'resend' | 'enqueue'>,
  mlsId: string,
  actorPubkey: string,
  devices: Map<string, NostrEvent[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<InviteResult> {
  const group = await groups.get(mlsId);
  const batch = buildInviteBatch(group.state, actorPubkey, devices);
  if (batch.unreachable.length > 0 || !batch.intent) {
    throw new MarmotUnusableKeyPackageError(batch.unreachable[0] ?? '');
  }
  const intent = batch.intent;
  const total = intent.welcomeRecipients?.length ?? 0;
  let done = 0;
  onProgress?.(0, total);
  const { result, failed } = await outbox.capture(
    () => groups.send(mlsId, intent),
    () => onProgress?.(++done, total),
  );
  const delivered = deliveredAccounts(result);
  const stillFailed = failed.length > 0 ? await outbox.resend(failed) : [];
  for (const w of failed) if (!stillFailed.includes(w)) delivered.add(w.recipient);
  if (stillFailed.length > 0) await outbox.enqueue(mlsId, stillFailed);
  const undelivered = [...devices.keys()].filter((p) => !delivered.has(p));
  if (__DEV__) {
    const counts = [...batch.devices].map(([p, n]) => `${p.slice(0, 8)}×${n}`).join(', ');
    console.log(
      `[Marmot] invited ${counts} into ${mlsId.slice(0, 8)}` +
        (undelivered.length > 0 ? `; ${undelivered.length} not reached yet` : ''),
    );
  }
  return { undelivered };
}
