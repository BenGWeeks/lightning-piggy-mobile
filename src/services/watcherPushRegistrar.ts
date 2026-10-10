// Keeps the notification watcher's registration for this phone in step with
// the user's choices — the lifecycle half of watcherRegistration.ts.
//
// A registration is one seal signature. For Amber / NIP-46 users that is a
// prompt, so the rules are about WHEN we may ask:
//   - user actions (a category toggle, Retry, adding / removing an NWC
//     wallet) and a changed push token register straight away, debounced so
//     a burst of toggles is ONE signature;
//   - plain app start never prompts, except for the 7-day refresh the
//     watcher needs (registrations are deleted after 30 days unrefreshed);
//   - a relay-list change alone is folded into the next registration (a
//     silent nsec signer re-registers right away);
//   - anything else a remote signer can't do now is left "pending" for the
//     Settings screen's Retry.
// Everything runs on one chain, so two signer requests never overlap (Amber
// rejects concurrent intents with BUSY) and `ts` stays strictly increasing.

import type { SignerType } from '../types/nostr';
import type { PushDevice } from './marmotPushRegistration';
import type { RegisteredRecord, WatcherAccountState } from './watcherPushStore';
import {
  anyCategory,
  buildRegistrationWrap,
  MAX_NWC_CONNECTIONS,
  nextRegistrationTs,
  nwcProof,
  parseNwcConnection,
  pushTokenHash,
  registrationFingerprint,
  selectRegistrationRelays,
  type NwcConnectionInfo,
  type RegisterContent,
  type SealSigner,
  type WatcherCategories,
  type WatcherCategory,
} from './watcherRegistration';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { NostrEvent } from 'nostr-tools/pure';

export const REFRESH_AFTER_MS = 7 * 86400_000;
const DEBOUNCE_MS = 2_000;
/** Relay lists hydrate in stages at start — wait for them to settle. */
const RELAY_DEBOUNCE_MS = 10_000;

/** Why a sync was asked for. */
export type SyncTrigger = 'start' | 'relays' | 'nwc' | 'token' | 'user';

export interface WatcherContext {
  pubkey: string;
  signerType: SignerType;
  /** The user's DM inbox relays (kind 10050). */
  inboxRelays: string[];
  /** The user's read relays (kind 10002). */
  readRelays: string[];
  /** The account's NWC wallets, in display order. */
  nwcWalletIds: string[];
}

export type PlanAction = 'none' | 'register' | 'unregister' | 'defer';

export interface Desired {
  fingerprint: string;
  coreFingerprint: string;
  tokenHash: string;
}

/**
 * Pure: what to do now. `desired` is what should be registered (null: nothing
 * — no category on or push off), `registered` what the watcher holds.
 */
export function planWatcherSync(args: {
  desired: Desired | null;
  registered: RegisteredRecord | null;
  triggers: ReadonlySet<SyncTrigger>;
  silentSigner: boolean;
  nowMs: number;
}): PlanAction {
  const { desired, registered, triggers, silentSigner, nowMs } = args;
  const interactive =
    silentSigner || triggers.has('user') || triggers.has('nwc') || triggers.has('token');
  if (!desired) {
    if (!registered) return 'none';
    return interactive ? 'unregister' : 'defer';
  }
  if (!registered) return interactive ? 'register' : 'defer';
  // A new push token: the old registration is dead weight — always worth a signature.
  if (registered.tokenHash !== desired.tokenHash) return 'register';
  const due = nowMs - registered.at >= REFRESH_AFTER_MS;
  if (registered.fingerprint === desired.fingerprint) return due ? 'register' : 'none';
  if (registered.coreFingerprint === desired.coreFingerprint) {
    // Only the relays moved: not worth a prompt on its own.
    return due || silentSigner || triggers.has('user') ? 'register' : 'none';
  }
  return interactive || due ? 'register' : 'defer';
}

/** Fingerprint of a registration that may have reached the watcher but was
 * never confirmed: matches nothing, so the next pass re-sends it. */
const UNCONFIRMED = 'unconfirmed';

export type WatcherSyncOutcome =
  | 'registered'
  | 'unregistered'
  | 'unchanged'
  /** Needs a signature we may not ask for now — Retry in Settings. */
  | 'pending'
  /** The signer refused, or no relay took it. */
  | 'failed'
  /** No account, no token yet, or storage unreadable. */
  | 'unavailable';

export interface WatcherStatus {
  busy: boolean;
  /** The last sync's outcome, for the active account. */
  last: WatcherSyncOutcome | null;
}

export interface WatcherDeps {
  device: () => PushDevice | null | undefined;
  appId: () => string | null;
  apnsEnv: () => Promise<'production' | 'sandbox' | undefined>;
  nwcUrl: (walletId: string) => Promise<string | null>;
  /** `cancelled` is checked before each signer request reaches the backend. */
  signer: (pubkey: string, signerType: SignerType, cancelled: () => boolean) => SealSigner;
  /** `stillValid` is checked right before the wrap goes out. */
  publish: (wrap: NostrEvent, stillValid: () => boolean) => Promise<boolean>;
  load: (pubkey: string) => Promise<WatcherAccountState>;
  save: (pubkey: string, state: WatcherAccountState) => Promise<void>;
  now: () => number;
}

interface NwcConn extends NwcConnectionInfo {
  client: string;
}

interface Built {
  body: Omit<RegisterContent, 'ts' | 'v'>;
  conns: NwcConn[];
  desired: Desired;
}

export class WatcherPushRegistrar {
  private ctx: WatcherContext | null = null;
  private triggers = new Set<SyncTrigger>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private status: WatcherStatus = { busy: false, last: null };
  private readonly listeners = new Set<() => void>();
  private seenDevice: PushDevice | null | undefined = undefined;
  /** Bumped when the account changes: a registration prepared for the old
   * one must not be published after it (an unregister still may). */
  private generation = 0;

  constructor(private readonly deps: WatcherDeps) {}

  // --- inputs ---------------------------------------------------------------

  /** The signed-in account and what it watches; null when signed out. */
  setContext(next: WatcherContext | null): void {
    const prev = this.ctx;
    this.ctx = next;
    if (!next || !prev || prev.pubkey !== next.pubkey || prev.signerType !== next.signerType) {
      this.generation++;
    }
    if (!next) {
      this.cancelTimer();
      this.triggers.clear();
      return;
    }
    if (!prev || prev.pubkey !== next.pubkey || prev.signerType !== next.signerType) {
      // Another account: its own state, nothing carried over — including the
      // device snapshot (the token is per account: null unless it opted in).
      this.seenDevice = this.deps.device();
      this.triggers.clear();
      this.setStatus({ last: null });
      this.schedule('start');
      return;
    }
    if (prev.nwcWalletIds.join() !== next.nwcWalletIds.join()) this.schedule('nwc');
    if (
      prev.inboxRelays.join() !== next.inboxRelays.join() ||
      prev.readRelays.join() !== next.readRelays.join()
    ) {
      this.schedule('relays');
    }
  }

  /** The push token appeared or changed (push turned off: nothing to do —
   * the Settings screen unregisters before Marmot push deletes the token). */
  onDeviceChanged(): void {
    const device = this.deps.device();
    const first = this.seenDevice === undefined;
    const changed = device?.token !== this.seenDevice?.token;
    // A different token (or none): a registration in flight for the old one
    // is pointless — and after push-off, must not go out at all.
    if (!first && changed) this.generation++;
    this.seenDevice = device;
    if (!device) return;
    if (first) this.schedule('start');
    else if (changed) this.schedule('token');
  }

  // --- user actions ---------------------------------------------------------

  async categories(): Promise<WatcherCategories | null> {
    const ctx = this.ctx;
    if (!ctx) return null;
    return (await this.deps.load(ctx.pubkey)).categories;
  }

  /** Persist a toggle now; register after the debounce (one signature per burst). */
  setCategory(category: WatcherCategory, on: boolean): Promise<WatcherCategories | null> {
    // The account the user toggled for — queued work runs later, possibly
    // after a switch, and must never change another account's choices.
    const pubkey = this.ctx?.pubkey ?? null;
    return this.serial(async () => {
      const ctx = this.ctx;
      if (!ctx || ctx.pubkey !== pubkey) return null;
      const state = await this.deps.load(ctx.pubkey);
      const categories = { ...state.categories, [category]: on };
      await this.deps.save(ctx.pubkey, { ...state, categories });
      this.schedule('user');
      return categories;
    });
  }

  /** Retry now (user action). */
  syncNow(): Promise<WatcherSyncOutcome> {
    this.cancelTimer();
    this.triggers.add('user');
    return this.serial(() => this.run());
  }

  /**
   * Push is being turned off, or the active account signs out (user action):
   * tell the watcher to forget this phone while the token and the signer
   * still exist. Bound to the account and token at the time of the call —
   * never a successor's — and skipped once `cancelled()` (the caller gave up
   * waiting). False when it couldn't.
   */
  unregisterNow(cancelled: () => boolean = () => false): Promise<boolean> {
    this.cancelTimer();
    this.triggers.clear();
    // A registration still in flight must not land after this unregister.
    this.generation++;
    const ctx = this.ctx;
    const device = this.deps.device() ?? null;
    if (!ctx) return Promise.resolve(true);
    return this.serial(async () => {
      if (cancelled()) return false;
      let state: WatcherAccountState;
      try {
        state = await this.deps.load(ctx.pubkey);
      } catch {
        return false;
      }
      if (!state.registered) return true;
      const outcome = await this.send(ctx, state, null, device, this.generation, cancelled);
      return outcome === 'unregistered' || outcome === 'unchanged';
    });
  }

  /** The account whose registration this registrar manages, if any. */
  activePubkey(): string | null {
    return this.ctx?.pubkey ?? null;
  }

  // --- status ---------------------------------------------------------------

  getStatus(): WatcherStatus {
    return this.status;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- internals ------------------------------------------------------------

  private setStatus(patch: Partial<WatcherStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l());
  }

  private serial<T>(op: () => Promise<T>): Promise<T> {
    const run = this.chain.then(op, op);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(trigger: SyncTrigger): void {
    this.triggers.add(trigger);
    this.cancelTimer();
    const relaysOnly = [...this.triggers].every((t) => t === 'relays');
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.serial(() => this.run());
      },
      relaysOnly ? RELAY_DEBOUNCE_MS : DEBOUNCE_MS,
    );
  }

  private async run(): Promise<WatcherSyncOutcome> {
    const triggers = this.triggers;
    this.triggers = new Set();
    const ctx = this.ctx;
    // Captured before any await: an account switch / sign-out from here on
    // must stop this registration from going out.
    const generation = this.generation;
    const device = this.deps.device();
    if (!ctx) return 'unavailable';
    if (device === undefined) {
      // No token yet: keep the reasons — the token listener brings us back.
      triggers.forEach((t) => this.triggers.add(t));
      return 'unavailable';
    }
    let state: WatcherAccountState;
    try {
      state = await this.deps.load(ctx.pubkey);
    } catch {
      return this.finish('unavailable');
    }
    const built =
      device && anyCategory(state.categories)
        ? await this.build(ctx, device, state.categories)
        : null;
    const action = planWatcherSync({
      desired: built?.desired ?? null,
      registered: state.registered,
      triggers,
      silentSigner: ctx.signerType === 'nsec',
      nowMs: this.deps.now(),
    });
    if (action === 'none') return this.finish('unchanged');
    if (action === 'defer') return this.finish('pending');
    return this.send(ctx, state, action === 'register' ? built : null, device, generation);
  }

  /** Sign + publish a register (`built`) or an unregister (null) of `device`. */
  private async send(
    ctx: WatcherContext,
    state: WatcherAccountState,
    built: Built | null,
    device: PushDevice | null,
    generation: number,
    cancelled: () => boolean = () => false,
  ): Promise<WatcherSyncOutcome> {
    const unregister = built === null;
    // Is this account still the one we manage? Its state is only written then
    // (a signed-out account's state was wiped and must stay wiped).
    const current = () => this.ctx?.pubkey === ctx.pubkey;
    // A register must not go out for an account that left meanwhile, or whose
    // token went away (push turned off for it); an unregister is bound to its
    // account and only stops when abandoned.
    const stillValid = () =>
      unregister
        ? !cancelled()
        : generation === this.generation && this.deps.device()?.token === device?.token;
    const reg = state.registered;
    if (unregister && !reg) return this.finish('unchanged');
    if (
      unregister &&
      (!device || pushTokenHash(device.platform, device.token) !== reg!.tokenHash)
    ) {
      // The registered token is gone (replaced or deleted): its registration
      // dies with it at Apple/Google — nothing to sign.
      if (current()) await this.deps.save(ctx.pubkey, { ...state, registered: null });
      return this.finish('unchanged');
    }
    const ts = nextRegistrationTs(state.lastTs, Math.floor(this.deps.now() / 1000));
    // The clock went back: wait until a strictly newer ts fits the window.
    if (ts === null) return this.finish('pending');
    this.setStatus({ busy: true });
    try {
      // Write-ahead: a crash after the publish must not reuse this ts.
      const sent: WatcherAccountState = { ...state, lastTs: ts };
      if (current()) await this.deps.save(ctx.pubkey, sent);
      if (!stillValid()) return this.finish('unavailable');
      const body = built
        ? {
            ...built.body,
            nwc: built.conns.map((c) => nwcProof(ctx.pubkey, c)),
          }
        : {
            action: 'unregister' as const,
            app: reg!.app,
            platform: reg!.platform,
            token: device!.token,
          };
      const wrap = await buildRegistrationWrap(
        this.deps.signer(ctx.pubkey, ctx.signerType, () => !stillValid()),
        body,
        ts,
      );
      // Signed out / switched while the signer was busy: drop it.
      if (!stillValid()) return this.finish('unavailable');
      // Write-ahead: a relay may take the registration even if its ack never
      // arrives. Until confirmed, record it as "possibly registered" — so an
      // unregister still goes out for it, and a later pass retries.
      if (built && current()) {
        await this.deps.save(ctx.pubkey, {
          ...sent,
          registered: {
            fingerprint: UNCONFIRMED,
            coreFingerprint: UNCONFIRMED,
            tokenHash: built.desired.tokenHash,
            platform: built.body.platform,
            app: built.body.app,
            at: this.deps.now(),
          },
        });
      }
      if (!(await this.deps.publish(wrap, stillValid))) {
        return this.finish(stillValid() ? 'failed' : 'unavailable');
      }
      const registered: RegisteredRecord | null = built
        ? {
            ...built.desired,
            platform: built.body.platform,
            app: built.body.app,
            at: this.deps.now(),
          }
        : null;
      // The account may have been removed meanwhile: don't resurrect its state.
      if (current()) await this.deps.save(ctx.pubkey, { ...sent, registered });
      return this.finish(unregister ? 'unregistered' : 'registered');
    } catch (e) {
      if (__DEV__) console.warn('[WatcherPush] registration failed:', e);
      return this.finish(stillValid() ? 'failed' : 'unavailable');
    } finally {
      this.setStatus({ busy: false });
    }
  }

  private finish(outcome: WatcherSyncOutcome): WatcherSyncOutcome {
    this.setStatus({ last: outcome });
    return outcome;
  }

  /** What should be registered. Proofs are signed only at send time. */
  private async build(
    ctx: WatcherContext,
    device: PushDevice,
    categories: WatcherCategories,
  ): Promise<Built | null> {
    const app = this.deps.appId();
    if (!app) return null;
    const conns = categories.payment ? await this.nwcConnections(ctx) : [];
    const relays = selectRegistrationRelays(categories, {
      nwc: conns.flatMap((c) => c.relays),
      inbox: ctx.inboxRelays,
      read: ctx.readRelays,
    });
    const apnsEnv = device.platform === 'apns' ? await this.deps.apnsEnv() : undefined;
    const body: Omit<RegisterContent, 'ts' | 'v'> = {
      action: 'register',
      app,
      platform: device.platform,
      token: device.token,
      ...(apnsEnv ? { apns_env: apnsEnv } : {}),
      categories,
      relays,
      // Placeholder entries (client/wallet only) for the fingerprint.
      nwc: conns.map((c) => ({ client: c.client, wallet: c.wallet, proof: '' })),
    };
    return {
      body,
      conns,
      desired: {
        fingerprint: registrationFingerprint(body),
        coreFingerprint: registrationFingerprint(body, { withRelays: false }),
        tokenHash: pushTokenHash(device.platform, device.token),
      },
    };
  }

  /** Up to 3 distinct NWC connections, in wallet order. */
  private async nwcConnections(ctx: WatcherContext): Promise<NwcConn[]> {
    const out: NwcConn[] = [];
    for (const id of ctx.nwcWalletIds) {
      if (out.length === MAX_NWC_CONNECTIONS) break;
      const url = await this.deps.nwcUrl(id).catch(() => null);
      const conn = url ? parseNwcConnection(url) : null;
      if (!conn) continue;
      const client = bytesToHex(schnorr.getPublicKey(hexToBytes(conn.secret)));
      // The watcher refuses an NWC client key equal to the user's own key.
      if (client === ctx.pubkey) continue;
      if (out.some((o) => o.client === client && o.wallet === conn.wallet)) continue;
      out.push({ ...conn, client });
    }
    return out;
  }
}
