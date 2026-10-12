// Which devices each person has in each Marmot chat (#1267): the data behind
// the 1:1 by-line, the members sheet's device lists, the message-info "Sent
// from" line and the alpha-only device notices.
//
// Read-only over group state: it never sends, commits or publishes anything.
// It keeps three small per-account records in the Marmot KV store:
//   - `deviceKeys`: leaf signature key → the invitation key (kind 30443) it
//     came from — which app published it (`client` tag) and when. Written
//     when WE invite a device (we hold its invitation key then) or found by
//     a bounded relay lookup when the members sheet opens.
//   - `deviceLeaves`: per group, the leaves as of the last commit we
//     processed, with the epoch (and time) each was first seen.
//   - `deviceNotices`: per group, the "X joined on 2 devices" lines drawn
//     from those commits. Local only — never sent to anyone.
//
// marmot-ts reports a state change for EVERY message (the secret tree moves
// on), but leaves only change with a commit, which always moves the epoch —
// so all work here is gated on the epoch and costs nothing per message.

import type { ClientState } from '@internet-privacy/marmot-ts/mls';
import type { Event as NostrEvent } from 'nostr-tools';

import {
  deviceCounts,
  diffLeaves,
  keyPackageClient,
  keyPackageSignatureKey,
  readGroupLeaves,
  type GroupLeaf,
  type LeafSnapshot,
} from './marmotDevices';
import type { MarmotKvBackend } from './marmotStore';

const KEYS_NS = 'deviceKeys';
const LEAVES_NS = 'deviceLeaves';
const NOTICES_NS = 'deviceNotices';
/** Notices kept per chat (oldest dropped). */
export const MAX_DEVICE_NOTICES = 50;
/** A person's invitation keys are looked up at most this often. */
export const DEVICE_LOOKUP_COOLDOWN_MS = 10 * 60_000;
/** At most this many people's invitation keys are looked up per sheet open. */
export const MAX_DEVICE_LOOKUPS = 8;

/** A group as the tracker reads it. */
export interface TrackedGroup {
  idStr: string;
  state: Pick<ClientState, 'ratchetTree' | 'groupContext'> & {
    privatePath?: { leafIndex: number };
  };
}

/** One device of one person, as the UI shows it. */
export interface DeviceInfo {
  /** Leaf signature key (hex): stable id for the device in this chat. */
  key: string;
  leafIndex: number;
  /** The app that published its invitation key, if known. */
  client: string | null;
  /** When its invitation key was made (unix seconds), if known. */
  keyCreatedAt: number | null;
  /** The epoch we first saw it in (null before the first snapshot). */
  firstEpoch: number | null;
  /** It was already here when we created / joined the chat. */
  baseline: boolean;
  /** When this phone processed the commit that added it (unix seconds);
   * null if it was here when we arrived. */
  seenAt: number | null;
  /** This device (the one we're running on). */
  isOwn: boolean;
}

export interface GroupDevices {
  epoch: number;
  /** Person (lower-case pubkey) → their devices, in leaf order. */
  people: Map<string, DeviceInfo[]>;
  /** Person → when this phone last saw one of their devices leave (unix s). */
  removedAt: ReadonlyMap<string, number>;
}

/** A device change, drawn locally from a commit. */
export interface DeviceNotice {
  id: string;
  /** When we processed the commit (unix seconds). */
  at: number;
  epoch: number;
  pubkey: string;
  /** Newly in the chat (vs. adding a device to it). */
  joined: boolean;
  /** The new devices' leaf signature keys. */
  keys: string[];
}

/** A notice with the app each new device runs, where known. */
export interface DeviceNoticeView extends DeviceNotice {
  clients: (string | null)[];
}

interface KeyRecord {
  client: string | null;
  publishedAt: number;
}

/** What one state change looked like, captured when it happened. */
interface Observation {
  idStr: string;
  leaves: GroupLeaf[];
  epoch: number;
  atSecs: number;
}

export interface MarmotDeviceTrackerOptions {
  backend: Pick<MarmotKvBackend, 'get' | 'set'>;
  /** The loaded groups. */
  groups: () => readonly TrackedGroup[];
  /** A person's kind-30443 events (bounded relay query). */
  fetchKeyPackages: (pubkey: string) => Promise<NostrEvent[]>;
  /** Our own `client` name — this device always knows what it is. */
  ownClient: string;
  now?: () => number;
}

const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export class MarmotDeviceTracker {
  private readonly opts: MarmotDeviceTrackerOptions;
  private readonly snapshots = new Map<string, LeafSnapshot | null>();
  private readonly chains = new Map<string, Promise<void>>();
  private readonly observedEpoch = new Map<string, number>();
  private readonly watched = new Set<string>();
  private readonly lookedUp = new Map<string, number>();
  private readonly listeners = new Set<(idStr: string) => void>();
  private readonly countsCache = new Map<string, { epoch: number; counts: Map<string, number> }>();

  constructor(opts: MarmotDeviceTrackerOptions) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private group(idStr: string): TrackedGroup | undefined {
    return this.opts.groups().find((g) => g.idStr === idStr);
  }

  /** How many groups are loaded — lets a screen notice a new chat cheaply. */
  groupCount(): number {
    return this.opts.groups().length;
  }

  /** The chat's current epoch; null if it isn't loaded. */
  epochOf(idStr: string): number | null {
    const g = this.group(idStr);
    return g ? Number(g.state.groupContext.epoch) : null;
  }

  /** Called with a group's MLS id hex when its notices or device names change. */
  subscribe(listener: (idStr: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(idStr: string): void {
    for (const l of this.listeners) l(idStr);
  }

  /**
   * Follow a group: baseline its leaves now (the state we created or joined),
   * then compare after every commit. Idempotent per group.
   */
  watch(g: TrackedGroup & { on(event: 'stateChanged', fn: () => void): unknown }): void {
    if (this.watched.has(g.idStr)) return;
    this.watched.add(g.idStr);
    this.observe(g);
    g.on('stateChanged', () => this.observe(g));
  }

  /**
   * Note the group's state. Skipped unless the epoch moved (a commit). The
   * leaves are read NOW, synchronously — the group object keeps changing, and
   * a queued read could miss a state (an add then a remove would show neither).
   * Comparison + storage then run serialised per group.
   */
  observe(g: TrackedGroup): Promise<void> {
    const epoch = Number(g.state.groupContext.epoch);
    if (this.observedEpoch.get(g.idStr) === epoch) {
      return this.chains.get(g.idStr) ?? Promise.resolve();
    }
    this.observedEpoch.set(g.idStr, epoch);
    const seen: Observation = {
      idStr: g.idStr,
      leaves: readGroupLeaves(g.state),
      epoch,
      atSecs: Math.floor(this.now() / 1000),
    };
    const run = (this.chains.get(g.idStr) ?? Promise.resolve())
      .then(() => this.compare(seen))
      .catch((e) => {
        if (__DEV__) console.warn('[Marmot] device tracking failed:', e);
      });
    this.chains.set(g.idStr, run);
    return run;
  }

  private async compare({ idStr, leaves, epoch, atSecs }: Observation): Promise<void> {
    const prev = await this.snapshot(idStr);
    const { snapshot, added } = diffLeaves(prev, leaves, epoch, atSecs);
    this.snapshots.set(idStr, snapshot);
    // Persist only when the set of leaves changed (not on every epoch).
    const keys = (s: LeafSnapshot | null) => (s ? Object.keys(s.leaves).sort().join() : null);
    if (keys(prev) !== keys(snapshot)) {
      await this.opts.backend.set(LEAVES_NS, idStr, JSON.stringify(snapshot));
    }
    if (added.length === 0) return;
    const notices = await this.storedNotices(idStr);
    for (const a of added) {
      notices.push({
        id: `${idStr.slice(0, 8)}-${epoch}-${a.pubkey.slice(0, 8)}`,
        at: atSecs,
        epoch,
        ...a,
      });
    }
    await this.opts.backend.set(
      NOTICES_NS,
      idStr,
      JSON.stringify(notices.slice(-MAX_DEVICE_NOTICES)),
    );
    this.emit(idStr);
  }

  private async snapshot(idStr: string): Promise<LeafSnapshot | null> {
    if (!this.snapshots.has(idStr)) {
      this.snapshots.set(idStr, parse<LeafSnapshot>(await this.opts.backend.get(LEAVES_NS, idStr)));
    }
    return this.snapshots.get(idStr) ?? null;
  }

  /** Record the invitation keys we're inviting devices with (who made each). */
  async rememberKeyPackages(events: Iterable<NostrEvent>): Promise<void> {
    for (const e of events) {
      const key = keyPackageSignatureKey(e);
      if (!key) continue;
      const record: KeyRecord = { client: keyPackageClient(e), publishedAt: e.created_at };
      await this.opts.backend.set(KEYS_NS, key, JSON.stringify(record));
    }
  }

  /** Each person's device count — a tree walk once per epoch, cached. */
  counts(idStr: string): Map<string, number> | null {
    const g = this.group(idStr);
    if (!g) return null;
    const epoch = Number(g.state.groupContext.epoch);
    const cached = this.countsCache.get(idStr);
    if (cached?.epoch === epoch) return cached.counts;
    const counts = deviceCounts(readGroupLeaves(g.state));
    this.countsCache.set(idStr, { epoch, counts });
    return counts;
  }

  private async storedNotices(idStr: string): Promise<DeviceNotice[]> {
    return parse<DeviceNotice[]>(await this.opts.backend.get(NOTICES_NS, idStr)) ?? [];
  }

  /** The chat's notices, oldest first, each with its devices' apps. */
  async notices(idStr: string): Promise<DeviceNoticeView[]> {
    const g = this.group(idStr);
    const own = g ? readGroupLeaves(g.state).find((l) => l.isOwn)?.key : undefined;
    const stored = await this.storedNotices(idStr);
    const out: DeviceNoticeView[] = [];
    for (const n of stored) {
      const clients: (string | null)[] = [];
      for (const key of n.keys) {
        clients.push(key === own ? this.opts.ownClient : await this.clientOf(key));
      }
      out.push({ ...n, clients });
    }
    return out;
  }

  private async clientOf(key: string): Promise<string | null> {
    return parse<KeyRecord>(await this.opts.backend.get(KEYS_NS, key))?.client ?? null;
  }

  /** Every device in the chat with what we know about it; null if not loaded. */
  async devices(idStr: string): Promise<GroupDevices | null> {
    const g = this.group(idStr);
    if (!g) return null;
    // Tree and epoch read together, before any await.
    const leaves = readGroupLeaves(g.state);
    const epoch = Number(g.state.groupContext.epoch);
    // Let the comparison for this state land first, so its epochs are known.
    await this.chains.get(idStr);
    const snapshot = await this.snapshot(idStr);
    const people = new Map<string, DeviceInfo[]>();
    for (const leaf of leaves) {
      const record = leaf.isOwn
        ? null
        : parse<KeyRecord>(await this.opts.backend.get(KEYS_NS, leaf.key));
      const seen = snapshot?.leaves[leaf.key];
      const info: DeviceInfo = {
        key: leaf.key,
        leafIndex: leaf.leafIndex,
        client: leaf.isOwn ? this.opts.ownClient : (record?.client ?? null),
        keyCreatedAt: leaf.keyCreatedAt ?? record?.publishedAt ?? null,
        firstEpoch: seen?.firstEpoch ?? null,
        baseline: seen?.baseline ?? false,
        seenAt: seen?.seenAt ?? null,
        isOwn: leaf.isOwn,
      };
      const list = people.get(leaf.pubkey);
      if (list) list.push(info);
      else people.set(leaf.pubkey, [info]);
    }
    return { epoch, people, removedAt: new Map(Object.entries(snapshot?.removedAt ?? {})) };
  }

  /**
   * Find which app made the devices we don't know yet: look up those people's
   * invitation keys (bounded: a few people, each at most once per cooldown)
   * and match each key's leaf signature key against the tree. A device whose
   * key has since been replaced on relays stays unknown ("Unknown app").
   * Returns true if anything new was learnt (and notifies listeners).
   */
  async resolveClients(idStr: string): Promise<boolean> {
    const view = await this.devices(idStr);
    if (!view) return false;
    const now = this.now();
    const wanted = new Map<string, Set<string>>();
    for (const [pubkey, devices] of view.people) {
      const unknown = devices.filter((d) => !d.isOwn && d.client === null).map((d) => d.key);
      const last = this.lookedUp.get(pubkey);
      if (unknown.length === 0 || (last !== undefined && now - last < DEVICE_LOOKUP_COOLDOWN_MS)) {
        continue;
      }
      wanted.set(pubkey, new Set(unknown));
      if (wanted.size >= MAX_DEVICE_LOOKUPS) break;
    }
    if (wanted.size === 0) return false;
    const found: NostrEvent[] = [];
    await Promise.all(
      [...wanted].map(async ([pubkey, keys]) => {
        this.lookedUp.set(pubkey, now);
        const events = await this.opts.fetchKeyPackages(pubkey).catch(() => []);
        for (const e of events) {
          if (e.kind !== 30443 || e.pubkey.toLowerCase() !== pubkey) continue;
          const key = keyPackageSignatureKey(e);
          if (key && keys.has(key)) found.push(e);
        }
      }),
    );
    if (found.length === 0) return false;
    await this.rememberKeyPackages(found);
    this.emit(idStr);
    return true;
  }
}
