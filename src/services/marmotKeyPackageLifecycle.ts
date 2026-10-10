// Keeping this install's Marmot key package (kind 30443) fresh, and deciding
// how long the private material of the ones it replaces is kept.
//
//  - One publication slot (`d`) per account per install; every refresh reuses
//    it, so relays replace the old event instead of piling up stale ones.
//  - The key package is refreshed weekly (#1210) — or sooner, once half its
//    lifetime has passed — so it never silently expires on relays.
//  - Retention of a replaced key package's private material (spec:
//    foundation/key-packages.md, "last-resort" rules) — see
//    `shouldDeleteReplacedKeyPackage` for the policy and its spec deviation.

import {
  getKeyPackageLifetime,
  GROUP_ENCRYPTED_MEDIA_V2_COMPONENT_ID,
  type KeyPackageManager,
} from '@internet-privacy/marmot-ts';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import type { EventSigner } from 'applesauce-core';
import type { Event as NostrEvent } from 'nostr-tools';

import type { MarmotKvBackend } from './marmotStore';

type ListedKeyPackage = Awaited<ReturnType<KeyPackageManager['list']>>[number];

const DAY_SECS = 24 * 60 * 60;
/** Refresh our published key package at least this often (#1210). */
export const KEY_PACKAGE_REFRESH_SECS = 7 * DAY_SECS;
/** Clock-skew grace before an expired key package's secret is dropped. */
const EXPIRY_GRACE_SECS = 60 * 60;

/**
 * RETENTION POLICY (decided by Ben on #1230): how long an UNUSED key package's
 * private material is kept after a newer one replaced it in our slot.
 *
 * The spec (foundation/key-packages.md) says a last-resort key package's
 * private material MUST be deleted once its replacement is confirmed
 * published. We deliberately deviate for UNUSED replaced keys: relays and
 * peers can briefly keep serving the previous key package after our weekly
 * refresh, and an invite made with it would otherwise fail with "No matching
 * secret". MDK / White Noise make the same trade-off (they keep unused
 * replaced keys until `not_after`, up to 84 days); we are stricter — 30 days,
 * matching the inviter-side freshness window of "invite all fresh devices"
 * (only key packages published in the last 30 days are invited), so an older
 * key is effectively never invited any more.
 *
 * USED (consumed) key packages follow the spec exactly: deleted as soon as
 * their replacement is confirmed published. Set this to 0 for strict spec
 * behaviour.
 */
export const UNUSED_REPLACED_KEY_RETENTION_SECS = 30 * DAY_SECS;

/** A valid `d` slot: 32 random bytes, hex (transports/nostr.md). */
export const SLOT_ID_HEX = /^[0-9a-f]{64}$/;

const MEDIA_V2_COMPONENT_TAG = `0x${GROUP_ENCRYPTED_MEDIA_V2_COMPONENT_ID.toString(16)}`;
/** White Noise requires every invitee to support encrypted media v2 (0x800b). */
export const advertisesMediaV2 = (events: NostrEvent[]) =>
  events.some((e) =>
    e.tags.some((t) => t[0] === 'app_components' && t.includes(MEDIA_V2_COMPONENT_TAG)),
  );

export interface KeyPackageLifetimeSecs {
  notBefore: number;
  notAfter: number;
}

/** The MLS lifetime of a stored key package, in unix seconds. */
export function keyPackageLifetime(kp: ListedKeyPackage): KeyPackageLifetimeSecs | undefined {
  const event = latestPublished(kp);
  const fromEvent = event ? getKeyPackageLifetime(event) : undefined;
  const leaf = kp.publicPackage?.leafNode as
    | { lifetime?: { notBefore: bigint; notAfter: bigint } }
    | undefined;
  const lifetime = fromEvent ?? leaf?.lifetime;
  if (!lifetime) return undefined;
  return { notBefore: Number(lifetime.notBefore), notAfter: Number(lifetime.notAfter) };
}

function latestPublished(kp: ListedKeyPackage): NostrEvent | undefined {
  const events = (kp.published ?? []) as NostrEvent[];
  return events.reduce<NostrEvent | undefined>(
    (newest, e) => (!newest || e.created_at > newest.created_at ? e : newest),
    undefined,
  );
}

/** When the key package was last published (unix seconds), if ever. */
export function publishedAt(kp: ListedKeyPackage): number | undefined {
  return latestPublished(kp)?.created_at;
}

/**
 * The key package peers should be inviting: this install's NEWEST published
 * one (in `slot`, when given) — undefined if there is none, or if that newest
 * one is consumed or not current-profile, so a new one must be published.
 * Deliberately not "the newest unused one": a retained older key package
 * must never hide that the one relays now advertise was just consumed.
 */
export function currentKeyPackage(
  list: ListedKeyPackage[],
  slot?: string,
): ListedKeyPackage | undefined {
  const newest = list
    .filter((kp) => publishedAt(kp) !== undefined)
    .filter((kp) => slot === undefined || kp.identifier === undefined || kp.identifier === slot)
    .sort((a, b) => (publishedAt(b) ?? 0) - (publishedAt(a) ?? 0))[0];
  return newest && !newest.used && !newest.nonCurrent ? newest : undefined;
}

/** Whether `kp` is due a refresh: a week old, or past half its lifetime. */
export function needsRefresh(kp: ListedKeyPackage, nowSecs: number): boolean {
  const at = publishedAt(kp);
  if (at === undefined || nowSecs - at >= KEY_PACKAGE_REFRESH_SECS) return true;
  const lifetime = keyPackageLifetime(kp);
  if (!lifetime) return true;
  const half = lifetime.notBefore + (lifetime.notAfter - lifetime.notBefore) / 2;
  return nowSecs >= half;
}

const sameKeyPackage = (a: ListedKeyPackage, b: ListedKeyPackage) =>
  a.keyPackageRef.join() === b.keyPackageRef.join();

/**
 * When `kp` was replaced: the publication time of the next key package this
 * install published after it (if that one has since been retired too, the
 * next surviving one — at most a refresh period later).
 */
export function replacedAt(kp: ListedKeyPackage, list: ListedKeyPackage[]): number | undefined {
  const at = publishedAt(kp);
  if (at === undefined) return undefined;
  const later = list.map(publishedAt).filter((t): t is number => t !== undefined && t > at);
  return later.length > 0 ? Math.min(...later) : undefined;
}

/**
 * The retention policy for a key package that `current` (our newest
 * confirmed-published one) has superseded. Used → delete now (spec). Never
 * published → nobody can hold it, delete now. Unused → kept for
 * UNUSED_REPLACED_KEY_RETENTION_SECS after it was replaced.
 */
export function shouldDeleteReplacedKeyPackage(
  kp: ListedKeyPackage,
  current: ListedKeyPackage,
  list: ListedKeyPackage[],
  nowSecs: number,
): boolean {
  const currentAt = publishedAt(current);
  const at = publishedAt(kp);
  if (sameKeyPackage(kp, current) || currentAt === undefined) return false; // no confirmed replacement
  // Newer than "current" (e.g. its publish failed): not replaced. Same-second
  // ties count as replaced — `current` is the one we chose to keep.
  if (at !== undefined && at > currentAt) return false;
  if (kp.used || at === undefined) return true;
  const replaced = replacedAt(kp, list) ?? currentAt;
  return nowSecs - replaced >= UNUSED_REPLACED_KEY_RETENTION_SECS;
}

/**
 * Key packages whose private material can go: past their lifetime (plus
 * grace), or replaced by `current` per the retention policy. `current` is
 * never returned; without one only expiry applies.
 */
export function retiredKeyPackages(
  list: ListedKeyPackage[],
  nowSecs: number,
  current?: ListedKeyPackage,
): ListedKeyPackage[] {
  return list.filter((kp) => {
    if (current && sameKeyPackage(kp, current)) return false;
    const lifetime = keyPackageLifetime(kp);
    if (lifetime !== undefined && nowSecs > lifetime.notAfter + EXPIRY_GRACE_SECS) return true;
    return current !== undefined && shouldDeleteReplacedKeyPackage(kp, current, list, nowSecs);
  });
}

/** Thrown when maintenance is abandoned because the session stopped. */
export class KeyPackageMaintenanceCancelled extends Error {
  constructor() {
    super('marmot: key package maintenance cancelled');
    this.name = 'KeyPackageMaintenanceCancelled';
  }
}

export interface MaintainKeyPackageOptions {
  relays: string[];
  /** This install's publication slot (`d`) for the account. */
  slot: string;
  client: string;
  /** Whether a published key package already advertises everything peers need. */
  isUpToDate: (published: NostrEvent[]) => boolean;
  /**
   * Whether at least one relay accepted a key-package event we just
   * published (see trackKeyPackageAcceptance). Undefined = not tracked.
   */
  wasAccepted?: (eventId: string) => boolean;
  /** Checked after every await: true once the session stopped (sign-out). */
  cancelled?: () => boolean;
  nowSecs?: number;
}

/**
 * Make sure peers can invite this install: publish a key package into our
 * slot when there is none, when ours is due its weekly refresh, or when it
 * lacks a capability peers require. Once the replacement is confirmed
 * published, retire what it replaced (retention policy above) and anything
 * expired. 'failed' when no relay accepted the replacement (nothing deleted).
 */
export async function maintainKeyPackage(
  keyPackages: KeyPackageManager,
  opts: MaintainKeyPackageOptions,
): Promise<'published' | 'unchanged' | 'failed'> {
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000);
  const step = async <T>(p: Promise<T>): Promise<T> => {
    const value = await p;
    if (opts.cancelled?.()) throw new KeyPackageMaintenanceCancelled();
    return value;
  };
  if (opts.cancelled?.()) throw new KeyPackageMaintenanceCancelled();
  // Pre-fix builds used a fixed, non-hex `d` slot, which spec-conformant
  // clients (White Noise) reject — retire those (publishes a NIP-09 delete).
  const malformed = (await step(keyPackages.list())).filter(
    (kp) => kp.identifier !== undefined && !SLOT_ID_HEX.test(kp.identifier),
  );
  if (malformed.length > 0) await step(keyPackages.purge(malformed.map((kp) => kp.keyPackageRef)));
  const list = await step(keyPackages.list());
  let current = currentKeyPackage(list, opts.slot);
  const stale =
    !current ||
    needsRefresh(current, now) ||
    !opts.isUpToDate((current.published ?? []) as NostrEvent[]);
  let outcome: 'published' | 'unchanged' = 'unchanged';
  if (stale) {
    // NOT keyPackages.rotate(): that deletes the old private material at
    // once, before the replacement is known to have reached any relay.
    const created = await step(
      keyPackages.create({ relays: opts.relays, identifier: opts.slot, client: opts.client }),
    );
    const ref = created.keyPackageRef.join();
    const fresh = (await step(keyPackages.list())).find((kp) => kp.keyPackageRef.join() === ref);
    const event = fresh ? latestPublished(fresh) : undefined;
    if (!fresh || !event || (opts.wasAccepted && !opts.wasAccepted(event.id))) {
      // No relay took it: nobody can invite it. Keep everything else.
      await step(keyPackages.remove(created.keyPackageRef));
      return 'failed';
    }
    current = fresh;
    outcome = 'published';
  }
  for (const kp of retiredKeyPackages(await step(keyPackages.list()), now, current)) {
    await step(keyPackages.remove(kp.keyPackageRef));
  }
  return outcome;
}

type PublishingNetwork = {
  publish(relays: string[], event: NostrEvent): Promise<Record<string, { ok: boolean }>>;
};

/** Record, in `accepted`, every kind-30443 event at least one relay accepted. */
export function trackKeyPackageAcceptance<N extends PublishingNetwork>(
  network: N,
  accepted: Set<string>,
): N {
  return {
    ...network,
    async publish(relays: string[], event: NostrEvent) {
      const result = await network.publish(relays, event);
      if (event.kind === 30443 && Object.values(result).some((r) => r.ok)) accepted.add(event.id);
      return result;
    },
  };
}

/**
 * The kind-30443 `d` slot: 32 random bytes, hex, generated once per account
 * per device and reused for every replacement (transports/nostr.md — it MUST
 * NOT be derived from identity material).
 */
export async function ensureKeyPackageSlot(backend: MarmotKvBackend): Promise<string> {
  const stored = await backend.get('meta', 'keyPackageSlot');
  if (stored && SLOT_ID_HEX.test(stored)) return stored;
  const slot = bytesToHex(randomBytes(32));
  await backend.set('meta', 'keyPackageSlot', slot);
  return slot;
}

/**
 * Runs `task` one at a time. A request while it runs queues exactly ONE more
 * run (shared by every such request), so state that changed mid-run — e.g. a
 * key package spent by a join — is never missed.
 */
export class SingleFlight {
  private running: Promise<void> | null = null;
  private queued: Promise<void> | null = null;
  constructor(private readonly task: () => Promise<void>) {}

  /** The run (or queued rerun) in progress, if any. */
  get current(): Promise<void> | null {
    return this.queued ?? this.running;
  }

  run(): Promise<void> {
    if (!this.running) {
      this.running = this.task().finally(() => (this.running = null));
      return this.running;
    }
    const again = () => {
      this.queued = null;
      return this.run();
    };
    this.queued ??= this.running.then(again, again);
    return this.queued;
  }
}

/**
 * `signer`, but each kind-30443 event it signs is dated strictly after the
 * previous one in the same `d` slot. Relays keep the LOWER event id on a
 * same-second addressable replace, so a replacement published in the same
 * second as the key package it replaces (e.g. right after a join spent it)
 * could lose — and relays would keep advertising a key whose private
 * material we then delete.
 */
export function monotonicKeyPackageSigner(signer: EventSigner): EventSigner {
  const lastBySlot = new Map<string, number>();
  return {
    ...signer,
    signEvent: (draft) => {
      const slot = draft.tags.find((t) => t[0] === 'd')?.[1];
      if (draft.kind !== 30443 || slot === undefined) return signer.signEvent(draft);
      const createdAt = Math.max(draft.created_at, (lastBySlot.get(slot) ?? 0) + 1);
      lastBySlot.set(slot, createdAt);
      return signer.signEvent({ ...draft, created_at: createdAt });
    },
  };
}
