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
  GroupRumorHistory,
  type MarmotGroup,
} from '@internet-privacy/marmot-ts';
import type { EventSigner } from 'applesauce-core';
import { bytesToHex } from '@noble/hashes/utils.js';
import { getEventHash, type Event as NostrEvent, type Filter } from 'nostr-tools';

import type { SignerType } from '../types/nostr';
import { installMarmotCryptoProvider, marmotCryptoProvider } from './marmotCryptoProvider';
import {
  candidateMediaStates,
  deriveMediaKeys,
  encryptMarmotMedia,
  renderableAttachments,
  type MarmotMediaKeys,
} from './marmotMedia';
import { forgetMarmotDeletionsForGroup } from './marmotDeletionStore';
import { spreadProposals } from './marmotProposals';
import {
  advertisesMediaV2,
  ensureKeyPackageSlot,
  maintainKeyPackage,
  monotonicKeyPackageSigner,
  SingleFlight,
  trackKeyPackageAcceptance,
} from './marmotKeyPackageLifecycle';
import { retryPendingRetirement } from './marmotKeyPackageRetire';
import { fetchDevices, inviteDevices, resolveInvitees } from './marmotInvitees';
import { createMarmotNetwork, createPushTransport } from './marmotNetwork';
import {
  leafKey,
  PUSH_TOKEN_LIST_KIND,
  PUSH_TOKEN_REMOVAL_KIND,
  PUSH_TOKEN_UPDATE_KIND,
  PUSH_TRIGGERING_KINDS,
} from './marmotPush';
import type { SignedProof } from './marmotPushEntries';
import { MarmotPushNotifier, type PushGroup } from './marmotPushNotifier';
import { MarmotPushRegistrar } from './marmotPushRegistrar';
import { createMarmotSigner } from './marmotSigner';
import * as fence from './marmotSessionFence';
import { isPermanentWelcomeFailure } from './marmotWelcomeFailure';
import {
  createMarmotKvStore,
  createSqliteMarmotBackend,
  type MarmotKvBackend,
} from './marmotStore';
import { makeKeyValueRumorHistoryFactory } from '@internet-privacy/marmot-ts/extra';
import type { Rumor } from 'applesauce-common/helpers/gift-wrap';

/** Marmot's default chat-message kind (foundation/application-messages.md). */
export const MARMOT_CHAT_KIND = 9;
/** App-level group id prefix, distinguishing Marmot groups from NIP-17 ones. */
export const MARMOT_GROUP_ID_PREFIX = 'marmot:';
/** Marks our key packages (`client` tag) — NOT the slot id; see ensureKeyPackageSlot. */
const CLIENT_NAME = 'Lightning Piggy';
const GROUP_EVENT_KIND = 445;
// Re-read this far behind the newest INGESTED kind-445 (honest clock drift
// between members). The watermark only advances after ingestion and ignores
// future-dated events, so a short margin loses nothing — and every second of
// margin is re-fetched and trial-decrypted on the JS thread at each app start
// (spec: `since` is a fetch hint — transports/nostr.md).
const GROUP_BACKFILL_SLACK_SECS = 10 * 60;
const GROUP_BACKFILL_LIMIT = 500;
const DELIVERED_CACHE_SIZE = 2_000;
// Startup replay window + retained history per group (see replayHistory).
const HISTORY_REPLAY_SECS = 7 * 24 * 60 * 60;
const HISTORY_KEEP = 500;
const historyNamespace = (groupIdHex: string) => `history:${groupIdHex}`;
type SessionGroup = MarmotGroup<GroupRumorHistory>;
// Relay `created_at` is sender-controlled: an event dated in the future
// (anyone can publish a kind-445 with a group's public `h` tag) must never
// push the durable since-watermark past real traffic.
const MAX_FUTURE_SKEW_SECS = 5 * 60;
const isPlausibleTimestamp = (createdAt: number) =>
  createdAt <= Math.floor(Date.now() / 1000) + MAX_FUTURE_SKEW_SECS;
// Sign-out waits at most this long for an in-flight key-package publish.
const KEY_PACKAGE_DRAIN_MS = 5_000;
const isMediaKeys = (v: unknown): v is MarmotMediaKeys =>
  !!v &&
  typeof v === 'object' &&
  Object.values(v).every(
    (ref) =>
      !!ref &&
      typeof (ref as { url?: unknown }).url === 'string' &&
      Array.isArray((ref as { keysHex?: unknown }).keysHex),
  );
// Safety stop for the paged backfill (500 × 40 = 20k events per group).
const GROUP_BACKFILL_MAX_PAGES = 40;

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
  /** File keys for the rumor's photos (MIP-04), derived when it arrived. */
  mediaKeys?: MarmotMediaKeys;
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
  /** Test seam: kind-445 backfill page size (default 500). */
  groupBackfillPageSize?: number;
  /** Test seam: sign-out's wait for a key-package publish (default 5 s). */
  keyPackageDrainMs?: number;
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
  private readonly client: MarmotClient<GroupRumorHistory>;
  private readonly listeners = new Set<MarmotSessionListener>();
  private readonly wiredGroups = new Set<string>();
  private readonly watermarks = new Map<string, number>();
  private readonly firstSeen = new Map<string, number>();
  private readonly creatingDms = new Map<string, Promise<MarmotGroupSummary>>();
  private readonly joiningWelcomes = new Set<string>();
  private readonly deliveredRumors = new Set<string>();
  private readonly push: MarmotPushNotifier;
  /** MIP-05: announcing THIS device's push token in our groups. */
  readonly pushRegistration: MarmotPushRegistrar;
  private connection: { unsubscribe(): void } | null = null;
  // Single-flight: start-up, resume, a new chat and a join can all ask at
  // once; one asking mid-run (e.g. a join just spent our key) gets a rerun.
  private readonly keyPackageRuns = new SingleFlight(() => this.maintainKeyPackages());
  private readonly gate = fence.createStopGate();
  private readonly acceptedKeyPackages = new Set<string>();
  private markReady!: () => void;
  /** Resolves once stored groups are loaded — joins must not race loadAll. */
  private readonly ready = new Promise<void>((resolve) => (this.markReady = resolve));

  constructor(opts: MarmotSessionOptions) {
    installMarmotCryptoProvider();
    this.opts = opts;
    this.pubkey = opts.pubkey;
    const backend = opts.backend ?? createSqliteMarmotBackend(opts.pubkey);
    this.backend = fence.fenceBackend(backend, this.gate); // drops writes after a wipe
    const store = <T>(ns: string) => createMarmotKvStore<T>(this.backend, ns);
    const network = opts.network ?? createMarmotNetwork(opts.getLookupRelays);
    this.push = new MarmotPushNotifier({
      pubkey: opts.pubkey,
      backend: this.backend,
      // Tests inject a fake network; the app uses strict relay access.
      transport: opts.network
        ? {
            publish: async (relays, event) => void (await network.publish(relays, event)),
            inboxRelays: (pk) => network.getUserInboxRelays(pk),
          }
        : createPushTransport(opts.getLookupRelays),
    });
    const signer = opts.signer ?? createMarmotSigner(opts.pubkey, opts.signerType);
    this.pushRegistration = new MarmotPushRegistrar({
      pubkey: opts.pubkey,
      silentSigner: opts.signerType === 'nsec',
      backend: this.backend,
      // A previous session of this account (A → B → A) may still be
      // finishing a publish + write: wait for it before planning anything.
      ready: Promise.all([this.ready, pushDrains.get(opts.pubkey)?.catch(() => undefined)]).then(
        () => undefined,
      ),
      groups: () =>
        this.client.groups.loaded
          .filter((g) => g.status === 'active')
          .map((g) => ({ ...this.pushGroup(g), ownLeaf: g.state.privatePath.leafIndex })),
      sign: (template) => signer.signEvent(template) as Promise<SignedProof>,
      send: async (idHex, event) => {
        const rumor = buildMarmotRumor(this.pubkey, event);
        return Object.values(await this.sendRumor(toAppGroupId(idHex), rumor)).some(Boolean);
      },
    });
    // Abandoned on stop: a late Amber / NIP-46 answer can't publish after sign-out.
    const cancelled = () => this.gate.stopped;
    const clientSigner =
      opts.signer ?? createMarmotSigner(this.pubkey, opts.signerType, { cancelled });
    this.client = new MarmotClient({
      signer: fence.fenceSigner(monotonicKeyPackageSigner(clientSigner), this.gate),
      network: this.boundGroupQueries(trackKeyPackageAcceptance(network, this.acceptedKeyPackages)),
      cryptoProvider: marmotCryptoProvider,
      groupStateStore: store('groups'),
      keyPackageStore: store('keyPackages'),
      inviteStore: store('invites'),
      lifecycleStore: store('lifecycle'),
      ingestStateStore: store('ingest'),
      rewindStore: store('rewind'),
      removedMarkerStore: store('removed'),
      // Durable per-group message history: the safety net that makes delivery
      // survive the app dying between MLS processing and our own store write.
      historyFactory: makeKeyValueRumorHistoryFactory((groupId) =>
        store<Rumor>(historyNamespace(bytesToHex(groupId))),
      ),
    });
  }

  /** Load + connect every stored group, then keep a key package published. */
  async start(): Promise<void> {
    const groups = this.client.groups;
    for (const evt of ['created', 'joined', 'loaded', 'imported'] as const) {
      groups.on(evt, (g) => {
        this.wireGroup(g);
        this.emitGroupsChanged();
      });
    }
    for (const evt of ['left', 'removed', 'destroyed', 'disbanded'] as const) {
      groups.on(evt, (id: Uint8Array, ..._rest: unknown[]) => {
        // We're out of it: forget what we published there (MIP-05 state)
        // and its "delete for everyone" tombstones.
        this.pushRegistration.forgetGroup(bytesToHex(id));
        void forgetMarmotDeletionsForGroup(this.pubkey, toAppGroupId(bytesToHex(id))).catch(
          () => undefined,
        );
        this.emitGroupsChanged();
      });
    }
    groups.on('unloaded', () => this.emitGroupsChanged());
    try {
      // Inside the try: a store failure must still open the `ready` gate, or
      // every send/join awaiting it would hang instead of erroring.
      await this.loadWatermarks();
      const loaded = await groups.loadAll();
      loaded.forEach((g) => this.wireGroup(g));
      for (const g of loaded) {
        await this.replayHistory(g).catch((e) => {
          if (__DEV__) console.warn('[Marmot] history replay failed:', e);
        });
      }
    } finally {
      this.markReady();
    }
    if (this.gate.stopped) return;
    this.connection = groups.connectAll({ fallbackRelays: this.opts.getWriteRelays() });
    this.emitGroupsChanged();
    // Publishing a key package needs a signature. Local keys sign silently;
    // Amber / NIP-46 would prompt on every app start for an Alpha feature the
    // user may never open — so for them it waits for first Marmot use (or an
    // account that has used Marmot before and needs its package kept fresh).
    void this.keepKeyPackageFresh();
    void this.retryPendingWelcomes();
  }

  /** Re-attempt Welcomes whose join failed transiently in an earlier session. */
  private async retryPendingWelcomes(): Promise<void> {
    for (const id of await this.backend.keys('pendingWelcomes')) {
      if (this.gate.stopped) return;
      const raw = await this.backend.get('pendingWelcomes', id);
      if (!raw) continue;
      try {
        await this.acceptWelcome(JSON.parse(raw) as MarmotRumor);
      } catch {
        // leave it pending for the next start
      }
    }
  }

  stop(): void {
    this.gate.stop();
    const run = this.keyPackageRuns.current;
    const pushStopped = Promise.all([this.push.stop(), this.pushRegistration.stop()]);
    fence.trackStoppedSession(this.pubkey, this.gate, Promise.all([run, pushStopped]));
    // Accumulated: an earlier session of the same account (A → B → A) may
    // still be finishing a write the wipe must wait for. A key-package run
    // only gets a bounded wait — its signer was just abandoned.
    const drainMs = this.opts.keyPackageDrainMs ?? KEY_PACKAGE_DRAIN_MS;
    pushDrains.set(
      this.pubkey,
      Promise.all([
        pushDrains.get(this.pubkey),
        fence.settleWithin(run, drainMs),
        pushStopped,
      ]).then(() => undefined),
    );
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
  ensureKeyPackage(): Promise<void> {
    return this.gate.stopped ? Promise.resolve() : this.keyPackageRuns.run();
  }

  /** Start-up / app resume: refresh, but never a first remote-signer prompt. */
  async keepKeyPackageFresh(): Promise<void> {
    if (this.opts.signerType === 'nsec' || (await this.client.keyPackages.count()) > 0) {
      await this.ensureKeyPackage();
    }
  }

  private async maintainKeyPackages(): Promise<void> {
    if (this.gate.stopped) return; // a rerun queued before sign-out
    try {
      // Refresh weekly into the same slot, and republish when ours predates
      // a capability White Noise requires of every invitee (encrypted media
      // v2, 0x800b). Replaced keys are retired per the retention policy.
      const cancelled = () => this.gate.stopped;
      const slot = await this.gate.guard(ensureKeyPackageSlot(this.backend));
      await maintainKeyPackage(this.client.keyPackages, {
        relays: this.writeRelays(),
        slot,
        client: CLIENT_NAME,
        isUpToDate: advertisesMediaV2,
        wasAccepted: (id) => this.acceptedKeyPackages.has(id),
        cancelled,
      });
      // A sign-out of this account here whose relay cleanup failed: retry it
      // now the account's signer is back (and already in use).
      await retryPendingRetirement({
        owner: this.pubkey,
        keepSlot: slot,
        cancelled,
        sign: (t) => this.client.signer.signEvent(t) as Promise<NostrEvent>,
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
    // Newest wins: if the peer lost their MLS state (reinstall, new device)
    // and started a fresh DM, the old group is a dead end they can't read.
    return this.listGroups()
      .filter((g) => g.isDm && g.memberPubkeys[0] === p)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  /** Whether `peer` has published a Marmot key package we could invite. */
  async canMessage(peer: string): Promise<boolean> {
    const lookup = this.opts.getLookupRelays();
    return (await fetchDevices(this.client.network, lookup, peer).catch(() => [])).length > 0;
  }

  async getOrCreateDm(peer: string): Promise<MarmotGroupSummary> {
    // Stored groups must be loaded first, or an existing DM is missed and a
    // duplicate MLS group gets created for the same peer.
    await this.ready;
    const p = peer.toLowerCase();
    const existing = this.findDm(p);
    if (existing) return existing;
    // Single-flight per peer: creating + inviting takes several relay round
    // trips, and a second quick send must not create a second DM group.
    const inFlight = this.creatingDms.get(p);
    if (inFlight) return inFlight;
    const creating = this.createGroup('', [p], { adminPubkeys: [this.pubkey, p] }).finally(() =>
      this.creatingDms.delete(p),
    );
    this.creatingDms.set(p, creating);
    return creating;
  }

  async createGroup(
    name: string,
    members: string[],
    opts: { description?: string; adminPubkeys?: string[] } = {},
  ): Promise<MarmotGroupSummary> {
    await this.ready;
    // First Marmot use: become reachable ourselves BEFORE resolving the
    // invitees — otherwise two remote-signer accounts that both deferred
    // publishing could never bootstrap a chat (each fails on the other's
    // missing key package). Not awaited: the invite doesn't depend on it.
    void this.ensureKeyPackage();
    // Resolve every invitee's devices first so a missing one fails before we
    // create an orphan group.
    // White Noise DM shape: unnamed, one other person (see devicesForDm).
    const devices = await this.invitees(members, { dm: name === '' && members.length === 1 });
    const group = await this.client.groups.create(name, {
      description: opts.description ?? '',
      relays: this.writeRelays(),
      adminPubkeys: opts.adminPubkeys ?? [this.pubkey],
    });
    try {
      await inviteDevices(this.client.groups, group.idStr, this.pubkey, devices);
    } catch (e) {
      // Don't leave an empty, invisible group (and its relay sub) behind —
      // a retry would otherwise create another one each time.
      await this.client.groups.destroy(group.id).catch(() => undefined);
      this.emitGroupsChanged();
      throw e;
    }
    if (__DEV__)
      console.log(`[Marmot] created ${group.idStr.slice(0, 8)}, invited ${members.length}`);
    return this.summarise(group);
  }

  async addMembers(appGroupId: string, members: string[]): Promise<void> {
    const devices = await this.invitees(members);
    await inviteDevices(this.client.groups, toMlsGroupId(appGroupId), this.pubkey, devices);
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

  /** Encrypt a photo (MIP-04) under the group's current epoch. */
  async encryptMedia(appGroupId: string, plaintext: Uint8Array, mime: string, filename: string) {
    const group = await this.client.groups.get(toMlsGroupId(appGroupId));
    return encryptMarmotMedia(group, plaintext, mime, filename);
  }

  /**
   * Every event in a group's durable history (ours included), optionally
   * narrowed to `kinds`. Reactions arrive once over MLS like every app event,
   * so a reopened thread reads them back from here. Callers filter further
   * themselves: the history backend only honours kinds/authors/time bounds,
   * not tag filters such as `#e`.
   */
  async queryHistory(appGroupId: string, kinds?: number[]): Promise<MarmotRumor[]> {
    await this.ready;
    const group = this.client.groups.loaded.find((g) => g.idStr === toMlsGroupId(appGroupId));
    if (!group?.history) return [];
    return (await group.history.queryRumors(kinds ? { kinds } : {})) as MarmotRumor[];
  }

  /** Every DM group with `peer`, newest first — once stored groups have loaded.
   * (A peer who lost their MLS state leaves older DMs behind; messages there
   * still belong to the same conversation.) */
  async dmGroupIdsWith(peer: string): Promise<string[]> {
    await this.ready;
    const p = peer.toLowerCase();
    return this.listGroups()
      .filter((g) => g.isDm && g.memberPubkeys[0] === p)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((g) => g.id);
  }

  /** The group's current MLS epoch (a photo's key is bound to one). */
  async mediaEpoch(appGroupId: string): Promise<bigint> {
    return (await this.client.groups.get(toMlsGroupId(appGroupId))).state.groupContext.epoch;
  }

  /** Record the key of a photo we're sending, so its row reads back the
   * same when the startup replay re-delivers our own message. */
  async rememberMediaKeys(appGroupId: string, rumorId: string, keys: MarmotMediaKeys) {
    await this.backend.set(`mediaKeys:${toMlsGroupId(appGroupId)}`, rumorId, JSON.stringify(keys));
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
    if (__DEV__) {
      const ok = Object.values(byRelay).filter(Boolean).length;
      console.log(
        `[Marmot] sent kind ${rumor.kind} to ${appGroupId.slice(7, 15)}: ${ok}/${Object.keys(byRelay).length} relays`,
      );
    }
    // MIP-05: wake the other members' devices (best-effort, off the send path).
    const sent = this.client.groups.loaded.find((g) => g.idStr === toMlsGroupId(appGroupId));
    if (
      sent &&
      PUSH_TRIGGERING_KINDS.includes(rumor.kind) &&
      Object.values(byRelay).some(Boolean)
    ) {
      this.push.trigger(this.pushGroup(sent));
      this.pushRegistration.onUserSend(sent.idStr);
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
    // Each Welcome is joined at most once: inbox refreshes re-surface the
    // same gift wrap, and re-joining must never reset a group we already
    // hold. The marker is written on success or a PERMANENT failure only —
    // a transient error (relay / store) leaves the invite retryable.
    const id = welcomeRumor.id;
    if (this.joiningWelcomes.has(id) || (await this.backend.get('welcomes', id))) return null;
    this.joiningWelcomes.add(id);
    const markHandled = async () => {
      await this.backend.set('welcomes', id, String(Math.floor(Date.now() / 1000)));
      await this.backend.remove('pendingWelcomes', id);
    };
    try {
      // Durable until joined or permanently rejected: the inbox stores the
      // invite's gift wrap as processed and never re-routes it, so a transient
      // failure is retried from here (next session start) instead. Inside the
      // try so a failed write still releases `joiningWelcomes`.
      await this.backend.set('pendingWelcomes', id, JSON.stringify(welcomeRumor));
      const { group } = await this.client.joinGroupFromWelcome({ welcomeRumor });
      await markHandled();
      if (__DEV__) console.log(`[Marmot] joined ${group.idStr.slice(0, 8)} from welcome`);
      void this.ensureKeyPackage(); // the joined key package is now spent
      return this.summarise(group);
    } catch (e) {
      // Permanent = no key we hold opens it (another device's / a deleted key).
      const permanent = await isPermanentWelcomeFailure(this.client.keyPackages, welcomeRumor, e);
      if (permanent) await markHandled();
      if (__DEV__) {
        const kp = welcomeRumor.tags.find((t) => t[0] === 'e')?.[1]?.slice(0, 12);
        console.warn(`[Marmot] welcome for key package ${kp} failed (permanent: ${permanent}):`, e);
      }
      return null;
    } finally {
      this.joiningWelcomes.delete(id);
    }
  }

  // --- internals -----------------------------------------------------------

  private writeRelays(): string[] {
    return this.opts.getWriteRelays();
  }

  /** Each invitee's devices; throws for anyone with none we can invite. */
  private invitees(members: string[], opts?: { dm?: boolean }) {
    const lookup = this.opts.getLookupRelays();
    return resolveInvitees(this.client.network, lookup, this.pubkey, members, opts);
  }

  private summarise(g: SessionGroup): MarmotGroupSummary {
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
      // White Noise DM: unnamed, two ACCOUNTS — `members` is distinct pubkeys,
      // so a contact on several devices (3+ leaves) is still a DM. ≤2 so a DM
      // mid-creation (just us, invite not yet committed) never flashes up as
      // a 1-member group.
      isDm: name === '' && members.length <= 2,
      relays: g.relays ?? [],
      createdAt: this.firstSeen.get(g.idStr) ?? Date.now(),
    };
  }

  private wireGroup(g: SessionGroup): void {
    if (this.wiredGroups.has(g.idStr)) return;
    this.wiredGroups.add(g.idStr);
    // Membership / name changes (ours or another member's commit) move the epoch.
    g.on('stateChanged', () => {
      this.emitGroupsChanged();
      // A member left → drop their push records (MIP-05 "Record state").
      void this.push.reconcile(this.pushGroup(g)).catch(() => undefined);
    });
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
      this.deliver(g, rumor);
    });
  }

  private deliver(g: SessionGroup, rumor: MarmotRumor): void {
    // The same app event can surface twice (relay replay across a reconnect,
    // or the startup history replay); deliver it once so listeners never
    // double-notify. Keyed per group: an identical rumor sent into two
    // groups shares an id.
    const deliveryKey = `${g.idStr}:${rumor.id}`;
    if (this.deliveredRumors.has(deliveryKey)) return;
    this.deliveredRumors.add(deliveryKey);
    if (this.deliveredRumors.size > DELIVERED_CACHE_SIZE) {
      this.deliveredRumors.delete(this.deliveredRumors.values().next().value as string);
    }
    if (
      rumor.kind === PUSH_TOKEN_UPDATE_KIND ||
      rumor.kind === PUSH_TOKEN_LIST_KIND ||
      rumor.kind === PUSH_TOKEN_REMOVAL_KIND
    ) {
      // MIP-05 token gossip: kept as local push state, never a chat row.
      void this.push.ingest(this.pushGroup(g), rumor.kind, rumor.content).catch(() => undefined);
    }
    if (rumor.kind === MARMOT_CHAT_KIND && renderableAttachments(rumor.tags).length > 0) {
      // Capture the epochs NOW: the photo or voice note's key comes from the epoch it was
      // sent in, and retained epochs are pruned as the group moves on.
      const states = candidateMediaStates(g);
      void this.mediaKeysFor(g, rumor, states).then((mediaKeys) => this.emit(g, rumor, mediaKeys));
      return;
    }
    this.emit(g, rumor);
  }

  /** A group as MIP-05 push state sees it: id + its current member leaves. */
  private pushGroup(g: SessionGroup): PushGroup {
    const leaves = new Set<string>();
    for (const member of getGroupMembers(g.state)) {
      for (const leaf of getPubkeyLeafNodeIndexes(g.state, member)) {
        leaves.add(leafKey(member.toLowerCase(), Number(leaf)));
      }
    }
    return { idHex: g.idStr, id: g.id, leaves };
  }

  private emit(g: SessionGroup, rumor: MarmotRumor, mediaKeys?: MarmotMediaKeys): void {
    const event = { group: this.summarise(g), rumor, ...(mediaKeys ? { mediaKeys } : {}) };
    if (__DEV__) console.log(`[Marmot] recv kind ${rumor.kind} in ${g.idStr.slice(0, 8)}`);
    for (const l of this.listeners) l.onMessage?.(event);
  }

  /**
   * A photo message's file keys, derived once and kept: the startup history
   * replay re-delivers it after its epoch may have been pruned, and must not
   * replace the stored keys with ones that can no longer decrypt it.
   */
  private async mediaKeysFor(
    g: SessionGroup,
    rumor: MarmotRumor,
    states: SessionGroup['state'][],
  ): Promise<MarmotMediaKeys | undefined> {
    const ns = `mediaKeys:${g.idStr}`;
    try {
      const saved = await this.backend.get(ns, rumor.id);
      // Only trust a saved entry in the current shape; anything else (an
      // older dev build's format) is re-derived rather than read as empty.
      const parsed = saved ? (JSON.parse(saved) as unknown) : null;
      if (isMediaKeys(parsed)) return parsed;
      const keys = await deriveMediaKeys(
        states,
        g.ciphersuite,
        g.mediaService.mediaPolicy,
        rumor.tags,
      );
      await this.backend.set(ns, rumor.id, JSON.stringify(keys));
      return keys;
    } catch (e) {
      if (__DEV__) console.warn('[Marmot] media key derivation failed:', e);
      return undefined;
    }
  }

  /**
   * MLS delivers an app event exactly once: marmot-ts durably marks it
   * processed before emitting it, so if the app dies before its own stores
   * persist the message it is never re-delivered. The library saves it to
   * the (durable) group history first, though — so on start, replay recent
   * history into the listeners (their stores upsert idempotently by id; old
   * messages are past the notification window). Also prunes the history.
   */
  private async replayHistory(g: SessionGroup): Promise<void> {
    if (!g.history) return;
    const since = Math.floor(Date.now() / 1000) - HISTORY_REPLAY_SECS;
    const recent = (await g.history.queryRumors({ since })) as MarmotRumor[];
    recent.sort((a, b) => a.created_at - b.created_at).forEach((r) => this.deliver(g, r));
    const ns = historyNamespace(g.idStr);
    const ids = await this.backend.keys(ns);
    if (ids.length <= HISTORY_KEEP) return;
    const all = (await g.history.queryRumors({})) as MarmotRumor[];
    all.sort((a, b) => b.created_at - a.created_at);
    for (const old of all.slice(HISTORY_KEEP)) {
      await this.backend.remove(ns, old.id);
      await this.backend.remove(`mediaKeys:${g.idStr}`, old.id);
    }
  }

  private emitGroupsChanged(): void {
    this.pushRegistration.schedule();
    const groups = this.listGroups();
    for (const l of this.listeners) l.onGroupsChanged?.(groups);
  }

  /**
   * marmot-ts backfills a group with an UNBOUNDED `{kinds:[445], #h}` filter
   * on every connect. Bound it (#perf rules) without losing history:
   *  - `since` = newest *ingested* event − slack, so app start doesn't
   *    re-download a group's whole history;
   *  - the backfill pages backwards in `limit`-sized pages, so a device that
   *    was offline through > `limit` events still gets every commit it needs
   *    to decrypt later epochs;
   *  - the durable watermark only advances once that backfill is ingested.
   *    GroupsManager.connect drains the backfill BEFORE opening the live
   *    subscription, so a request's newest timestamp is held as pending and
   *    committed when the subscription for that group opens.
   */
  private boundGroupQueries(
    network: ReturnType<typeof createMarmotNetwork>,
  ): ReturnType<typeof createMarmotNetwork> {
    const groupH = (f: Filter) =>
      f.kinds?.includes(GROUP_EVENT_KIND) && f.since === undefined ? f['#h']?.[0] : undefined;
    const bound = (f: Filter): Filter => {
      const h = groupH(f);
      if (!h) return f;
      const seen = this.watermarks.get(h);
      return {
        ...f,
        limit: f.limit ?? this.opts.groupBackfillPageSize ?? GROUP_BACKFILL_LIMIT,
        ...(seen ? { since: seen - GROUP_BACKFILL_SLACK_SECS } : {}),
      };
    };
    const pending = new Map<string, number>();
    const commit = (h: string, createdAt: number) => {
      if (!isPlausibleTimestamp(createdAt)) return;
      if (createdAt <= (this.watermarks.get(h) ?? 0)) return;
      this.watermarks.set(h, createdAt);
      void this.backend.set('watermark', h, String(createdAt));
    };
    const hOf = (e: NostrEvent) => e.tags.find((t) => t[0] === 'h')?.[1];

    /** Page a bounded group filter backwards until a short page. */
    const backfill = async (relays: string[], f: Filter): Promise<NostrEvent[]> => {
      const limit = f.limit ?? GROUP_BACKFILL_LIMIT;
      const byId = new Map<string, NostrEvent>();
      let until: number | undefined;
      for (let page = 0; page < GROUP_BACKFILL_MAX_PAGES; page++) {
        const events = (await network.request(relays, {
          ...f,
          ...(until !== undefined ? { until } : {}),
        })) as NostrEvent[];
        const before = byId.size;
        for (const e of events) byId.set(e.id, e);
        if (events.length < limit || byId.size === before) break;
        until = Math.min(...events.map((e) => e.created_at));
      }
      return [...byId.values()];
    };

    return {
      ...network,
      request: async (relays, filters) => {
        const list = (Array.isArray(filters) ? filters : [filters]) as Filter[];
        const batches = await Promise.all(
          list.map((f) =>
            groupH(f)
              ? backfill(relays, bound(f))
              : (network.request(relays, f) as Promise<NostrEvent[]>),
          ),
        );
        const byId = new Map<string, NostrEvent>();
        for (const e of batches.flat()) byId.set(e.id, e);
        for (const e of byId.values()) {
          const h = e.kind === GROUP_EVENT_KIND ? hOf(e) : undefined;
          if (h && isPlausibleTimestamp(e.created_at) && e.created_at > (pending.get(h) ?? 0)) {
            pending.set(h, e.created_at);
          }
        }
        return [...byId.values()];
      },
      subscription: (relays, filters) => {
        const list = (Array.isArray(filters) ? filters : [filters]) as Filter[];
        const inner = network.subscription(relays, list.map(bound));
        return {
          subscribe: (observer) => {
            // Backfill for these groups has been ingested — commit it.
            for (const f of list) {
              const h = groupH(f);
              const ts = h ? pending.get(h) : undefined;
              if (h && ts) {
                commit(h, ts);
                pending.delete(h);
              }
            }
            return inner.subscribe({
              ...observer,
              next: (e) => {
                const ev = e as NostrEvent;
                const h = ev.kind === GROUP_EVENT_KIND ? hOf(ev) : undefined;
                if (h) commit(h, ev.created_at);
                observer.next?.(e);
              },
            });
          },
        };
      },
    };
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

export {
  isUsableKeyPackage,
  MarmotNoKeyPackageError,
  MarmotUnusableKeyPackageError,
} from './marmotKeyPackages';

// --- active-session registry ---------------------------------------------------

let active: MarmotSession | null = null;
const activeListeners = new Set<(s: MarmotSession | null) => void>();
// Per-owner promise for a stopped session's push work to settle.
const pushDrains = new Map<string, Promise<void>>();

/**
 * Before wiping `owner`'s Marmot storage: stop their session if it is still
 * active and wait for its queued push-state writes to settle, so none lands
 * after the wipe.
 */
export async function quiesceMarmotSession(owner: string): Promise<void> {
  if (active?.pubkey === owner) active.stop();
  await pushDrains.get(owner)?.catch(() => undefined);
  pushDrains.delete(owner);
  // Anything still running past the bounded wait must not touch the wipe.
  fence.fenceStoppedSessions(owner);
}

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
