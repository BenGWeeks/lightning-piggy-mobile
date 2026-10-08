// One Marmot (MLS-over-Nostr) client per signed-in account.
//
// Owns the marmot-ts `MarmotClient`: loads + connects every group, keeps an
// unused key package published, and exposes the handful of operations the
// app needs (send, create DM/group, invite, remove, rename, leave, accept an
// invite). Decrypted application messages are fanned out to listeners as
// plain rumors — `marmotInbox` decides where they're stored.
//
// Conventions shared with White Noise (interop):
//   - a DM is a 2-member group with an EMPTY name where both people are admins;
//   - chat text is kind 9 (Marmot's default chat kind);
//   - key packages (kind 30443) live on the account's NIP-65 write relays,
//     Welcomes are gift-wrapped to the invitee's kind-10050 inbox relays.

import {
  MarmotClient,
  createApplicationMessageIntent,
  deserializeApplicationData,
  getGroupMembers,
  getPubkeyLeafNodeIndexes,
  Proposals,
  type MarmotGroup,
} from '@internet-privacy/marmot-ts';
import type { EventSigner } from 'applesauce-core';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { getEventHash, type Event as NostrEvent, type Filter } from 'nostr-tools';

import type { SignerType } from '../types/nostr';
import { relayListFromTags } from '../utils/relayListEvents';
import { installMarmotCryptoProvider, marmotCryptoProvider } from './marmotCryptoProvider';
import { createMarmotNetwork } from './marmotNetwork';
import { createMarmotSigner } from './marmotSigner';
import {
  createMarmotKvStore,
  createSqliteMarmotBackend,
  type MarmotKvBackend,
} from './marmotStore';

/** Marmot's default chat-message kind (foundation/application-messages.md). */
export const MARMOT_CHAT_KIND = 9;
/** App-level group id prefix, distinguishing Marmot groups from NIP-17 ones. */
export const MARMOT_GROUP_ID_PREFIX = 'marmot:';
/** Marks our key packages (`client` tag) — NOT the slot id; see keyPackageSlot. */
const CLIENT_NAME = 'Lightning Piggy';
const SLOT_ID_HEX = /^[0-9a-f]{64}$/;
const GROUP_EVENT_KIND = 445;
// Relays may skew / members' clocks may drift: re-read this far behind the
// newest kind-445 we've seen for a group. Older events were already ingested
// in a previous session (ingest state is durable), so this only bounds work.
const GROUP_BACKFILL_SLACK_SECS = 2 * 24 * 60 * 60;
const GROUP_BACKFILL_LIMIT = 500;

export interface MarmotRumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface MarmotGroupSummary {
  /** App group id: `marmot:<mls group id hex>`. */
  id: string;
  name: string;
  description: string;
  /** Members other than the viewer. */
  memberPubkeys: string[];
  adminPubkeys: string[];
  /** White Noise DM convention: two members, empty name. */
  isDm: boolean;
  /** Relays the group's kind-445 traffic is published to. */
  relays: string[];
  /** When this device first saw the group (ms) — MLS carries no creation time. */
  createdAt: number;
}

export interface MarmotMessageEvent {
  group: MarmotGroupSummary;
  rumor: MarmotRumor;
}

export interface MarmotSessionListener {
  onMessage?: (event: MarmotMessageEvent) => void;
  onGroupsChanged?: (groups: MarmotGroupSummary[]) => void;
}

export interface MarmotSessionOptions {
  pubkey: string;
  signerType: SignerType;
  /** The viewer's NIP-65 write relays (key packages + new groups live here). */
  getWriteRelays: () => string[];
  /** Relays to look up other users' relay lists on. */
  getLookupRelays: () => string[];
  /** Test seam: defaults to the SQLCipher-backed store + the shared pool. */
  backend?: MarmotKvBackend;
  signer?: EventSigner;
  network?: ReturnType<typeof createMarmotNetwork>;
}

export const toAppGroupId = (mlsGroupIdHex: string) => `${MARMOT_GROUP_ID_PREFIX}${mlsGroupIdHex}`;
export const isMarmotGroupId = (id: string) => id.startsWith(MARMOT_GROUP_ID_PREFIX);
const toMlsGroupId = (appGroupId: string) => appGroupId.slice(MARMOT_GROUP_ID_PREFIX.length);

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

export class MarmotSession {
  readonly pubkey: string;
  private readonly opts: MarmotSessionOptions;
  private readonly backend: MarmotKvBackend;
  private readonly client: MarmotClient;
  private readonly listeners = new Set<MarmotSessionListener>();
  private readonly wiredGroups = new Set<string>();
  private readonly watermarks = new Map<string, number>();
  private readonly firstSeen = new Map<string, number>();
  private connection: { unsubscribe(): void } | null = null;
  private stopped = false;
  private markReady!: () => void;
  /** Resolves once stored groups are loaded — joins must not race loadAll. */
  private readonly ready = new Promise<void>((resolve) => (this.markReady = resolve));

  constructor(opts: MarmotSessionOptions) {
    installMarmotCryptoProvider();
    this.opts = opts;
    this.pubkey = opts.pubkey;
    this.backend = opts.backend ?? createSqliteMarmotBackend(opts.pubkey);
    const store = <T>(ns: string) => createMarmotKvStore<T>(this.backend, ns);
    const network = opts.network ?? createMarmotNetwork(opts.getLookupRelays);
    this.client = new MarmotClient({
      signer: opts.signer ?? createMarmotSigner(opts.pubkey, opts.signerType),
      network: this.boundGroupQueries(network),
      cryptoProvider: marmotCryptoProvider,
      groupStateStore: store('groups'),
      keyPackageStore: store('keyPackages'),
      inviteStore: store('invites'),
      lifecycleStore: store('lifecycle'),
      ingestStateStore: store('ingest'),
      rewindStore: store('rewind'),
      removedMarkerStore: store('removed'),
    });
  }

  /** Load + connect every stored group, then keep a key package published. */
  async start(): Promise<void> {
    await this.loadWatermarks();
    const groups = this.client.groups;
    for (const evt of ['created', 'joined', 'loaded', 'imported'] as const) {
      groups.on(evt, (g) => {
        this.wireGroup(g);
        this.emitGroupsChanged();
      });
    }
    for (const evt of ['left', 'removed', 'destroyed', 'disbanded', 'unloaded'] as const) {
      groups.on(evt, () => this.emitGroupsChanged());
    }
    try {
      const loaded = await groups.loadAll();
      loaded.forEach((g) => this.wireGroup(g));
    } finally {
      this.markReady();
    }
    if (this.stopped) return;
    this.connection = groups.connectAll({ fallbackRelays: this.opts.getWriteRelays() });
    this.emitGroupsChanged();
    void this.ensureKeyPackage();
  }

  stop(): void {
    this.stopped = true;
    this.connection?.unsubscribe();
    this.connection = null;
    for (const g of this.client.groups.loaded) {
      g.removeAllListeners('applicationMessage');
      g.removeAllListeners('stateChanged');
    }
    this.listeners.clear();
  }

  subscribe(listener: MarmotSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Publish an unused key package so others can start chats with us. */
  async ensureKeyPackage(): Promise<void> {
    try {
      const keyPackages = this.client.keyPackages;
      // Pre-fix builds used a fixed, non-hex `d` slot, which spec-conformant
      // clients (White Noise) reject — retire those (publishes a NIP-09 delete).
      const malformed = (await keyPackages.list()).filter(
        (kp) => kp.identifier !== undefined && !SLOT_ID_HEX.test(kp.identifier),
      );
      if (malformed.length > 0) await keyPackages.purge(malformed.map((kp) => kp.keyPackageRef));
      await keyPackages.ensurePublished({
        relays: this.writeRelays(),
        identifier: await this.keyPackageSlot(),
        client: CLIENT_NAME,
      });
    } catch (e) {
      if (__DEV__) console.warn('[Marmot] key package publish failed:', e);
    }
  }

  listGroups(): MarmotGroupSummary[] {
    return this.client.groups.loaded
      .filter((g) => g.status === 'active')
      .map((g) => this.summarise(g));
  }

  getGroup(appGroupId: string): MarmotGroupSummary | undefined {
    return this.listGroups().find((g) => g.id === appGroupId);
  }

  /** The DM group with `peer`, if one exists. */
  findDm(peer: string): MarmotGroupSummary | undefined {
    const p = peer.toLowerCase();
    return this.listGroups().find((g) => g.isDm && g.memberPubkeys[0] === p);
  }

  /** Whether `peer` has published a Marmot key package we could invite. */
  async canMessage(peer: string): Promise<boolean> {
    return (await this.fetchKeyPackage(peer)) !== null;
  }

  async getOrCreateDm(peer: string): Promise<MarmotGroupSummary> {
    const existing = this.findDm(peer);
    if (existing) return existing;
    return this.createGroup('', [peer], { adminPubkeys: [this.pubkey, peer.toLowerCase()] });
  }

  async createGroup(
    name: string,
    members: string[],
    opts: { description?: string; adminPubkeys?: string[] } = {},
  ): Promise<MarmotGroupSummary> {
    // Resolve every key package first so a missing one fails before we
    // create an orphan group.
    const keyPackages = await Promise.all(members.map((m) => this.requireKeyPackage(m)));
    const group = await this.client.groups.create(name, {
      description: opts.description ?? '',
      relays: this.writeRelays(),
      adminPubkeys: opts.adminPubkeys ?? [this.pubkey],
    });
    for (const kp of keyPackages) await this.client.groups.invite(group.id, kp);
    return this.summarise(group);
  }

  async addMembers(appGroupId: string, members: string[]): Promise<void> {
    const keyPackages = await Promise.all(members.map((m) => this.requireKeyPackage(m)));
    const mlsId = toMlsGroupId(appGroupId);
    for (const kp of keyPackages) await this.client.groups.invite(mlsId, kp);
    this.emitGroupsChanged();
  }

  async removeMember(appGroupId: string, member: string): Promise<void> {
    const mlsId = toMlsGroupId(appGroupId);
    const pk = member.toLowerCase();
    // One Remove per device leaf the member holds.
    const leaves = getPubkeyLeafNodeIndexes((await this.client.groups.get(mlsId)).state, pk);
    if (leaves.length === 0) return;
    await this.client.groups.commit(mlsId, {
      extraProposals: spreadProposals(Proposals.proposeRemoveUser(pk), leaves.length),
    });
    this.emitGroupsChanged();
  }

  async rename(appGroupId: string, name: string): Promise<void> {
    await this.client.groups.commit(toMlsGroupId(appGroupId), {
      // A name-only update yields exactly one group-profile proposal.
      extraProposals: spreadProposals(Proposals.proposeUpdateMetadata({ name }), 1),
    });
    this.emitGroupsChanged();
  }

  async leave(appGroupId: string): Promise<void> {
    await this.client.groups.leave(toMlsGroupId(appGroupId));
    this.emitGroupsChanged();
  }

  /** Send an app event; resolves with relay URL → accepted. */
  async sendRumor(appGroupId: string, rumor: MarmotRumor): Promise<Record<string, boolean>> {
    const results = await this.client.groups.send(
      toMlsGroupId(appGroupId),
      createApplicationMessageIntent(rumor),
    );
    const byRelay: Record<string, boolean> = {};
    for (const r of results) {
      for (const [url, res] of Object.entries(r.response)) byRelay[url] = byRelay[url] || res.ok;
    }
    return byRelay;
  }

  /**
   * Join from a decrypted kind-444 Welcome rumor (delivered gift-wrapped and
   * already unwrapped by the NIP-17 inbox path). Returns null when the
   * Welcome isn't for a key package we hold (e.g. an old invite).
   */
  async acceptWelcome(welcomeRumor: MarmotRumor): Promise<MarmotGroupSummary | null> {
    await this.ready;
    // Each Welcome is processed once: inbox refreshes re-surface the same
    // gift wrap, and re-joining must never reset a group we already hold.
    if (await this.backend.get('welcomes', welcomeRumor.id)) return null;
    await this.backend.set('welcomes', welcomeRumor.id, String(Math.floor(Date.now() / 1000)));
    try {
      const { group } = await this.client.joinGroupFromWelcome({ welcomeRumor });
      void this.ensureKeyPackage(); // the joined key package is now spent
      return this.summarise(group);
    } catch (e) {
      if (__DEV__) console.warn('[Marmot] could not join from welcome:', e);
      return null;
    }
  }

  // --- internals -----------------------------------------------------------

  private writeRelays(): string[] {
    return this.opts.getWriteRelays();
  }

  private summarise(g: MarmotGroup): MarmotGroupSummary {
    const view = g.groupData;
    const me = this.pubkey.toLowerCase();
    const members = getGroupMembers(g.state).map((p) => p.toLowerCase());
    const others = members.filter((p) => p !== me);
    const name = view?.name ?? '';
    return {
      id: toAppGroupId(g.idStr),
      name,
      description: view?.description ?? '',
      memberPubkeys: others,
      adminPubkeys: (view?.adminPubkeys ?? []).map((p) => p.toLowerCase()),
      // White Noise DM: unnamed, two members. ≤2 so a DM mid-creation (just
      // us, invite not yet committed) never flashes up as a 1-member group.
      isDm: name === '' && members.length <= 2,
      relays: g.relays ?? [],
      createdAt: this.firstSeen.get(g.idStr) ?? Date.now(),
    };
  }

  private wireGroup(g: MarmotGroup): void {
    if (this.wiredGroups.has(g.idStr)) return;
    this.wiredGroups.add(g.idStr);
    // Membership / name changes (ours or another member's commit) move the epoch.
    g.on('stateChanged', () => this.emitGroupsChanged());
    if (!this.firstSeen.has(g.idStr)) {
      const now = Date.now();
      this.firstSeen.set(g.idStr, now);
      void this.backend.set('firstSeen', g.idStr, String(now));
    }
    g.on('applicationMessage', (data: Uint8Array) => {
      let rumor: MarmotRumor;
      try {
        rumor = deserializeApplicationData(data) as MarmotRumor;
      } catch (e) {
        if (__DEV__) console.warn('[Marmot] undecodable app payload:', e);
        return;
      }
      const event = { group: this.summarise(g), rumor };
      for (const l of this.listeners) l.onMessage?.(event);
    });
  }

  private emitGroupsChanged(): void {
    const groups = this.listGroups();
    for (const l of this.listeners) l.onGroupsChanged?.(groups);
  }

  private async requireKeyPackage(peer: string): Promise<NostrEvent> {
    const kp = await this.fetchKeyPackage(peer);
    if (!kp) throw new MarmotNoKeyPackageError(peer);
    return kp;
  }

  /** Newest kind-30443 from the peer's NIP-65 write relays (spec: transports/nostr.md). */
  private async fetchKeyPackage(peer: string): Promise<NostrEvent | null> {
    const author = peer.toLowerCase();
    const network = this.client.network;
    const lookup = this.opts.getLookupRelays();
    const [relayList] = (await network.request(lookup, {
      kinds: [10002],
      authors: [author],
      limit: 1,
    })) as NostrEvent[];
    const writeSet = relayList
      ? relayListFromTags(relayList.tags)
          .filter((r) => r.write)
          .map((r) => r.url)
      : [];
    const events = (await network.request([...writeSet, ...lookup], {
      kinds: [30443],
      authors: [author],
      limit: 10,
    })) as NostrEvent[];
    events.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
    return events[0] ?? null;
  }

  /**
   * marmot-ts backfills a group with an UNBOUNDED `{kinds:[445], #h}` filter
   * on every connect. Bound it to `since` (newest seen − slack) + `limit` so
   * app start doesn't re-download each group's whole history (#perf rules).
   */
  private boundGroupQueries(
    network: ReturnType<typeof createMarmotNetwork>,
  ): ReturnType<typeof createMarmotNetwork> {
    const bound = (filters: Filter | Filter[]): Filter[] =>
      (Array.isArray(filters) ? filters : [filters]).map((f) => {
        const h = f['#h']?.[0];
        if (!h || !f.kinds?.includes(GROUP_EVENT_KIND) || f.since !== undefined) return f;
        const seen = this.watermarks.get(h);
        return {
          ...f,
          limit: f.limit ?? GROUP_BACKFILL_LIMIT,
          ...(seen ? { since: seen - GROUP_BACKFILL_SLACK_SECS } : {}),
        };
      });
    const note = (event: NostrEvent) => {
      if (event.kind !== GROUP_EVENT_KIND) return;
      const h = event.tags.find((t) => t[0] === 'h')?.[1];
      if (!h || event.created_at <= (this.watermarks.get(h) ?? 0)) return;
      this.watermarks.set(h, event.created_at);
      void this.backend.set('watermark', h, String(event.created_at));
    };
    return {
      ...network,
      request: async (relays, filters) => {
        const events = await network.request(relays, bound(filters as Filter | Filter[]));
        (events as NostrEvent[]).forEach(note);
        return events;
      },
      subscription: (relays, filters) => {
        const inner = network.subscription(relays, bound(filters as Filter | Filter[]));
        return {
          subscribe: (observer) =>
            inner.subscribe({
              ...observer,
              next: (e) => {
                note(e as NostrEvent);
                observer.next?.(e);
              },
            }),
        };
      },
    };
  }

  /**
   * The kind-30443 `d` slot: 32 random bytes, hex, generated once per account
   * per device and reused for every replacement (transports/nostr.md — it
   * MUST NOT be derived from identity material).
   */
  private async keyPackageSlot(): Promise<string> {
    const stored = await this.backend.get('meta', 'keyPackageSlot');
    if (stored && SLOT_ID_HEX.test(stored)) return stored;
    const slot = bytesToHex(randomBytes(32));
    await this.backend.set('meta', 'keyPackageSlot', slot);
    return slot;
  }

  private async loadWatermarks(): Promise<void> {
    for (const [ns, map] of [
      ['watermark', this.watermarks],
      ['firstSeen', this.firstSeen],
    ] as const) {
      for (const key of await this.backend.keys(ns)) {
        const v = Number(await this.backend.get(ns, key));
        if (Number.isFinite(v)) map.set(key, v);
      }
    }
  }
}

type CommitOptions = NonNullable<Parameters<MarmotClient['groups']['commit']>[1]>;
type SingleProposalAction = Extract<
  NonNullable<CommitOptions['extraProposals']>[number],
  (...args: never[]) => unknown
>;

/**
 * marmot-ts 0.6.1-next pushes an array-returning ProposalAction's result into
 * the commit UN-flattened (engine/group-engine.js), so builders like
 * `proposeRemoveUser` / `proposeUpdateMetadata` produce a malformed commit.
 * Split one into `count` single-proposal actions.
 */
function spreadProposals(
  action: (ctx: Parameters<SingleProposalAction>[0]) => Promise<unknown[]>,
  count: number,
): SingleProposalAction[] {
  return Array.from(
    { length: count },
    (_, i) =>
      (async (ctx: Parameters<SingleProposalAction>[0]) => {
        const proposals = await action(ctx);
        if (proposals.length !== count) throw new Error('marmot: unexpected proposal count');
        return proposals[i];
      }) as SingleProposalAction,
  );
}

export class MarmotNoKeyPackageError extends Error {
  constructor(readonly pubkey: string) {
    super(`No Marmot key package published for ${pubkey.slice(0, 8)}`);
    this.name = 'MarmotNoKeyPackageError';
  }
}

// --- active-session registry ---------------------------------------------------

let active: MarmotSession | null = null;
const activeListeners = new Set<(s: MarmotSession | null) => void>();

export function getMarmotSession(): MarmotSession | null {
  return active;
}

export function setMarmotSession(session: MarmotSession | null): void {
  if (active && active !== session) active.stop();
  active = session;
  for (const l of activeListeners) l(session);
}

/** Listen for the active session; fires immediately with the current one. */
export function subscribeMarmotSession(listener: (s: MarmotSession | null) => void): () => void {
  activeListeners.add(listener);
  listener(active);
  return () => activeListeners.delete(listener);
}
