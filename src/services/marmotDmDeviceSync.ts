// Keep an EXISTING 1:1 reaching every fresh device (#1559).
//
// A new chat invites all of a contact's fresh devices (#1238, marmotInvitees).
// But a device installed AFTER the chat began was never invited: the DM kept
// going to the old installs only, and the new app never saw the chat. So
// before a send (bounded wait) and when the chat is opened (staggered, in the
// background) we compare each person's fresh key packages with the leaves
// already in the group, and add the missing devices in ONE commit — the same
// invite path a new chat uses, so White Noise gets the commit shape it already
// accepts.
//
// "Already in the group" = a leaf with the key package's signature key. Every
// current client keeps one leaf signing key per install (Lightning Piggy
// #1492; MDK since v0.10, which excludes an "active sibling" the same way), so
// a refreshed or replenished key package of a joined install matches its
// leaf. Slots we invited ourselves are also remembered per group, which
// covers older installs that rotated their signing key.
//
// Both people's devices: the contact's and our own other installs (a key
// package is a public "invite me" — no linking or pairing, MIP-06 scope).
// White Noise contacts are the exception, as for a new chat (devicesForDm):
// released White Noise decides "is this a DM" by counting LEAVES, so a
// White Noise user gets only their newest White Noise install, and we never
// add our own extra installs to a 1:1 with them.
//
// Bounds (CLAUDE.md performance rules): at most one check per chat every
// 10 minutes (1 minute after a failure), one key-package lookup per person
// per 10 minutes, signature checks yield to the UI, at most
// MAX_DEVICES_PER_PERSON leaves per person, and a send waits at most a few
// seconds — on timeout or failure it goes to the current members and the add
// is retried later. Remote signers (Amber / NIP-46) are never prompted from a
// background check: each added device costs an approval, so for them only
// the lookup is warmed on open and the add waits for the user's next send.

import type { Event as NostrEvent } from 'nostr-tools';

import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import { keyPackageSignatureKey, readGroupLeaves, type GroupLeaf } from './marmotDevices';
import {
  devicesForDm,
  isWhiteNoise,
  MAX_DEVICES_PER_PERSON,
  selectDeviceKeyPackages,
} from './marmotInvitees';
import type { MarmotKvBackend } from './marmotStore';

/** A chat is checked at most this often after a successful check. */
export const DM_DEVICE_SYNC_COOLDOWN_MS = 10 * 60_000;
/** ...and retried this soon after a failed lookup or commit. */
export const DM_DEVICE_SYNC_RETRY_MS = 60_000;
/** The longest a send waits for the check before going to current members. */
export const DM_DEVICE_SYNC_SEND_WAIT_MS = 5_000;
const SLOTS_NS = 'dmDeviceSlots';
const MAX_RECORDED_SLOTS = 50;

const slotOf = (e: Pick<NostrEvent, 'tags'>) => e.tags.find((t) => t[0] === 'd')?.[1] ?? null;
const slotId = (pubkey: string, slot: string) => `${pubkey.toLowerCase()}:${slot}`;

export interface DmDevicePlanInput {
  self: string;
  peer: string;
  /** The group's member leaves now. */
  leaves: readonly Pick<GroupLeaf, 'pubkey' | 'key'>[];
  /** Person → their fresh devices, newest first (selectDeviceKeyPackages). */
  fresh: ReadonlyMap<string, NostrEvent[]>;
  /** The contact runs White Noise (any current key package says so). */
  peerOnWhiteNoise: boolean;
  /** `pubkey:slot` already invited into this group. */
  invitedSlots: ReadonlySet<string>;
  /** This install's own slot — never added (we ARE that leaf). */
  ownSlot: string | null;
  /** Test seam: a key package's leaf signature key. */
  signatureKeyOf?: (e: NostrEvent) => string | null;
}

/**
 * The devices to add: per person, fresh key packages whose install has no
 * leaf here yet (by signature key) and whose slot we haven't invited, within
 * the per-person cap. Pure.
 */
export function planDmDeviceAdds(input: DmDevicePlanInput): Map<string, NostrEvent[]> {
  const sigKey = input.signatureKeyOf ?? keyPackageSignatureKey;
  const self = input.self.toLowerCase();
  const peer = input.peer.toLowerCase();
  const inTree = new Set(input.leaves.map((l) => l.key));
  const plan = new Map<string, NostrEvent[]>();
  for (const person of [peer, self]) {
    if (person === self && input.peerOnWhiteNoise) continue;
    const leafCount = input.leaves.filter((l) => l.pubkey === person).length;
    const room = MAX_DEVICES_PER_PERSON - leafCount;
    const keys = new Set<string>();
    const add: NostrEvent[] = [];
    const fresh = input.fresh.get(person) ?? [];
    // A White Noise contact: their newest White Noise install or nothing.
    const candidates =
      person === peer && input.peerOnWhiteNoise
        ? fresh.filter(isWhiteNoise).slice(0, 1)
        : devicesForDm(fresh);
    for (const kp of candidates) {
      if (add.length >= room) break;
      const slot = slotOf(kp);
      if (!slot || input.invitedSlots.has(slotId(person, slot))) continue;
      if (person === self && slot === input.ownSlot) continue;
      const key = sigKey(kp);
      // One leaf per install: a key already in the tree (or twice in this
      // batch — two slots of one install, #1426) is that install.
      if (!key || inTree.has(key) || keys.has(key)) continue;
      keys.add(key);
      add.push(kp);
    }
    if (add.length > 0) plan.set(person, add);
  }
  return plan;
}

export interface DmDeviceSyncOptions {
  self: string;
  backend: Pick<MarmotKvBackend, 'get' | 'set'>;
  /** A person's kind-30443 events (bounded relay query). */
  fetchKeyPackages: (pubkey: string) => Promise<NostrEvent[]>;
  /** The group's current state (its ratchet tree). */
  groupState: (mlsId: string) => Promise<Parameters<typeof readGroupLeaves>[0]>;
  /** Add the devices in one commit; resolves once it's sent. */
  invite: (mlsId: string, devices: Map<string, NostrEvent[]>) => Promise<unknown>;
  ownSlot: () => Promise<string>;
  /** Local key: adding devices needs no approval, so a background check may commit. */
  silentSigner: boolean;
  stopped: () => boolean;
  /** Test seam: a send's wait (default DM_DEVICE_SYNC_SEND_WAIT_MS). */
  sendWaitMs?: number;
  now?: () => number;
}

export class MarmotDmDeviceSync {
  private readonly opts: DmDeviceSyncOptions;
  private readonly nextCheck = new Map<string, number>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly lookups = new Map<string, { at: number; events: Promise<NostrEvent[]> }>();

  constructor(opts: DmDeviceSyncOptions) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /**
   * Bring the 1:1 `mlsId` with `peer` up to date. `send`: waits a few seconds
   * at most. `open`: background; never prompts a remote signer. Never throws.
   */
  sync(mlsId: string, peer: string, reason: 'send' | 'open'): Promise<void> {
    if (this.opts.stopped() || (this.nextCheck.get(mlsId) ?? 0) > this.now()) {
      return Promise.resolve();
    }
    if (reason === 'open' && !this.opts.silentSigner) {
      // Warm the lookup so the next send's check is quick.
      for (const p of [peer, this.opts.self]) void this.lookup(p).catch(() => undefined);
      return Promise.resolve();
    }
    let run = this.running.get(mlsId);
    if (!run) {
      run = this.check(mlsId, peer.toLowerCase())
        .catch((e) => {
          if (__DEV__) console.warn('[Marmot] adding new devices failed:', e);
          return false;
        })
        .then((ok) => {
          const wait = ok ? DM_DEVICE_SYNC_COOLDOWN_MS : DM_DEVICE_SYNC_RETRY_MS;
          this.nextCheck.set(mlsId, this.now() + wait);
        })
        .finally(() => this.running.delete(mlsId));
      this.running.set(mlsId, run);
    }
    if (reason === 'open') return run;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.opts.sendWaitMs ?? DM_DEVICE_SYNC_SEND_WAIT_MS);
    });
    return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
  }

  /** A group's invite just went out (new chat or top-up): note its slots and
   * skip the next check — its devices are current as of now. */
  async noteInvited(mlsId: string, invited: readonly NostrEvent[]): Promise<void> {
    this.nextCheck.set(mlsId, this.now() + DM_DEVICE_SYNC_COOLDOWN_MS);
    const ids = invited.flatMap((e) => {
      const slot = slotOf(e);
      return slot ? [slotId(e.pubkey, slot)] : [];
    });
    if (ids.length === 0) return;
    const merged = [...new Set([...(await this.invitedSlots(mlsId)), ...ids])];
    await this.opts.backend.set(SLOTS_NS, mlsId, JSON.stringify(merged.slice(-MAX_RECORDED_SLOTS)));
  }

  private async invitedSlots(mlsId: string): Promise<string[]> {
    try {
      const parsed = JSON.parse((await this.opts.backend.get(SLOTS_NS, mlsId)) ?? '[]') as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  /** A person's key packages, looked up at most once per cooldown. */
  private lookup(pubkey: string): Promise<NostrEvent[]> {
    const p = pubkey.toLowerCase();
    const cached = this.lookups.get(p);
    if (cached && this.now() - cached.at < DM_DEVICE_SYNC_COOLDOWN_MS) return cached.events;
    const events = this.opts.fetchKeyPackages(p);
    this.lookups.set(p, { at: this.now(), events });
    events.catch(() => {
      if (this.lookups.get(p)?.events === events) this.lookups.delete(p);
    });
    return events;
  }

  /** True when every lookup worked (the check is then good for a cooldown). */
  private async check(mlsId: string, peer: string): Promise<boolean> {
    const self = this.opts.self.toLowerCase();
    let ok = true;
    const settled = await Promise.all(
      [peer, self].map((p) =>
        this.lookup(p).catch(() => {
          ok = false;
          return [] as NostrEvent[];
        }),
      ),
    );
    if (this.opts.stopped()) return ok;
    const fresh = new Map<string, NostrEvent[]>();
    const scheduler = createYieldScheduler({ safetyEvery: 4 });
    try {
      for (const [i, p] of [peer, self].entries()) {
        const opts = { yieldNow: scheduler.maybeYield, freshOnly: true };
        fresh.set(p, await selectDeviceKeyPackages(p, settled[i], opts));
      }
    } finally {
      scheduler.dispose();
    }
    const plan = planDmDeviceAdds({
      self,
      peer,
      leaves: readGroupLeaves(await this.opts.groupState(mlsId)),
      fresh,
      peerOnWhiteNoise: settled[0].some(isWhiteNoise),
      invitedSlots: new Set(await this.invitedSlots(mlsId)),
      ownSlot: await this.opts.ownSlot().catch(() => null),
    });
    if (plan.size === 0 || this.opts.stopped()) return ok;
    await this.opts.invite(mlsId, plan);
    return ok;
  }
}
