// Per-account MIP-05 registration of THIS device: keeps every Marmot group
// told about our current push token (kind 447) and retracts it (kind 449)
// when push is turned off or moved to another server.
//
// Each entry needs the user's signature over an owner proof that binds the
// group id, so one group = one signature. Local keys sign silently; Amber /
// NIP-46 show a prompt per signature. To keep prompts rare:
//   - what we last published per group is persisted, and nothing is re-signed
//     unless the registration itself changed (token, server, relay hint, our
//     leaf) — so app starts never prompt;
//   - a group that gained members gets the SAME signed record re-sent (the
//     owner proof is still valid), which costs no signature;
//   - a remote signer is only asked in response to a user action: turning
//     push on/off (every group, stopping at the first decline) or sending a
//     message in a group not yet set up (that one group). Background syncs
//     leave those groups pending.
// A token rotation on the same server re-publishes with a newer owner_ts,
// which supersedes the old record by the spec's ordering rule — no 449.

import type { PushRecord, Removal } from './marmotPush';
import {
  OwnerProofMismatch,
  buildOwnRecord,
  removalFor,
  signEntry,
  tokenRemovalEvent,
  tokenUpdateEvent,
  type DeviceRegistration,
  type Sign,
} from './marmotPushEntries';
import type { MarmotKvBackend } from './marmotStore';

const NAMESPACE = 'pushShare';
// Per group: the highest owner_ts we ever signed (447 or 449). Kept even
// after a removal, so a later entry always outranks our own tombstone —
// whatever the clock does.
const TS_NAMESPACE = 'pushShareTs';
// Batches group churn (joins, loads, commits) into one pass, off the
// latency-sensitive startup path.
const SCHEDULE_DELAY_MS = 3_000;

export interface RegistrarGroup {
  idHex: string;
  /** Our own MLS leaf in the group. */
  ownLeaf: number;
  /** Every current leaf as "member|leaf". */
  leaves: Set<string>;
}

/** What we last published in a group (persisted per group). */
interface Shared {
  record: PushRecord;
  /** The group's leaves when it was last sent — a new leaf means a resend. */
  leaves: string[];
}

type AppEvent = ReturnType<typeof tokenUpdateEvent>;

export interface RegistrarDeps {
  pubkey: string;
  /** Local key: signing never prompts. */
  silentSigner: boolean;
  backend: MarmotKvBackend;
  /** Resolves once every stored group is loaded: before that, a group
   * missing from `groups()` may just not be loaded yet. */
  ready: Promise<void>;
  groups: () => RegistrarGroup[];
  sign: Sign;
  /** Send an app event into a group; true once a relay accepted it. */
  send: (groupIdHex: string, event: AppEvent) => Promise<boolean>;
  now?: () => number;
}

export type GroupAction =
  | { type: 'none' }
  | { type: 'forget' }
  | { type: 'resend' }
  | { type: 'remove'; record: PushRecord }
  | { type: 'publish'; replaces?: PushRecord };

export interface SyncResult {
  published: number;
  removed: number;
  /** Groups still needing a signature (or a retry). */
  pending: number;
  /** The user declined a signer prompt; the rest of the pass was skipped. */
  declined: boolean;
}

const sameRegistration = (r: PushRecord, reg: DeviceRegistration) =>
  r.server === reg.server &&
  r.platform === reg.platform &&
  r.fingerprint === reg.fingerprint &&
  (r.relayHint ?? '') === (reg.relayHint?.trim() ? reg.relayHint : '');

const sameDevice = (a: DeviceRegistration, b: DeviceRegistration) =>
  a.server === b.server &&
  a.platform === b.platform &&
  a.fingerprint === b.fingerprint &&
  (a.relayHint ?? '') === (b.relayHint ?? '');

/** Pure: what a group needs, given what we published there before. */
export function planGroup(
  shared: Shared | null,
  reg: DeviceRegistration | null,
  group: RegistrarGroup,
): GroupAction {
  // A record for a leaf we no longer hold died with that leaf (members drop
  // it on the Remove commit) — nothing to retract.
  const current = shared && shared.record.leaf === group.ownLeaf ? shared : null;
  if (!reg) {
    if (current) return { type: 'remove', record: current.record };
    return shared ? { type: 'forget' } : { type: 'none' };
  }
  if (current && sameRegistration(current.record, reg)) {
    const added = [...group.leaves].some((l) => !current.leaves.includes(l));
    return added ? { type: 'resend' } : { type: 'none' };
  }
  // Same record key (leaf, platform, server): the newer owner_ts replaces it.
  // A different server or platform is a different key — retract the old one.
  const replaces =
    current && (current.record.server !== reg.server || current.record.platform !== reg.platform)
      ? current.record
      : undefined;
  return { type: 'publish', ...(replaces ? { replaces } : {}) };
}

/** The pass was overtaken (session stopped / registration changed). */
class Superseded extends Error {}

class SignerRefused extends Error {
  constructor(readonly cause: unknown) {
    super('push: signer did not sign the owner proof');
  }
}

export class MarmotPushRegistrar {
  // undefined = not known yet (token still being read): passes do nothing,
  // so a slow start can never be mistaken for "push turned off".
  private registration: DeviceRegistration | null | undefined = undefined;
  /** Bumped on every change, so an in-flight pass can tell it's stale. */
  private generation = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly settledListeners = new Set<() => void>();

  constructor(private readonly deps: RegistrarDeps) {}

  /** The token to announce, or null to retract it everywhere. */
  setRegistration(reg: DeviceRegistration | null): void {
    // A repeat of the same registration (e.g. the OS re-reporting the same
    // token) must not abandon a pass that is already publishing it.
    const cur = this.registration;
    if (reg === cur || (reg && cur && sameDevice(reg, cur))) return;
    this.registration = reg;
    this.generation++;
  }

  /** Background pass (debounced): never prompts a remote signer. */
  schedule(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync({ interactive: false }).catch(() => undefined);
    }, SCHEDULE_DELAY_MS);
  }

  /** The user just sent in this group: finish setting it up, if needed. */
  onUserSend(groupIdHex: string): void {
    if (this.stopped || !this.registration || this.deps.silentSigner) return;
    void this.sync({ interactive: true, groupIdHex }).catch(() => undefined);
  }

  /**
   * Bring every group (or one) in line with the current registration.
   * `interactive` = a user action is behind this, so a remote signer may
   * prompt. Runs strictly one pass at a time.
   */
  sync(opts: { interactive: boolean; groupIdHex?: string }): Promise<SyncResult> {
    const run = this.chain.then(() => this.runSync(opts));
    this.chain = run.catch(() => undefined);
    void run.finally(() => this.settledListeners.forEach((l) => l())).catch(() => undefined);
    return run;
  }

  /** Called after every pass (e.g. to refresh a "N chats pending" status). */
  onSettled(listener: () => void): () => void {
    this.settledListeners.add(listener);
    return () => this.settledListeners.delete(listener);
  }

  /** Groups not yet in line with the current registration. */
  async pendingCount(): Promise<number> {
    await this.deps.ready;
    const reg = this.registration;
    if (reg === undefined) return 0;
    let n = 0;
    for (const group of this.deps.groups()) {
      // Anything still to send counts (a resend needs no signature, but the
      // group still lacks our record); an unreadable group counts too.
      const action = await this.load(group.idHex).then(
        (shared) => planGroup(shared, reg, group).type,
        () => 'unknown',
      );
      if (action !== 'none' && action !== 'forget') n++;
    }
    return n;
  }

  /** We left (or were removed from) this group: forget what we published
   * there. Explicit — never inferred from a group missing from a load,
   * which may just have failed to load. */
  forgetGroup(groupIdHex: string): void {
    const run = this.chain.then(async () => {
      await this.deps.backend.remove(NAMESPACE, groupIdHex);
      await this.deps.backend.remove(TS_NAMESPACE, groupIdHex);
    });
    this.chain = run.catch(() => undefined);
  }

  /** Stop for good; resolves once an in-flight pass has settled. */
  stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.chain.then(() => undefined);
  }

  private async runSync(opts: { interactive: boolean; groupIdHex?: string }): Promise<SyncResult> {
    const result: SyncResult = { published: 0, removed: 0, pending: 0, declined: false };
    await this.deps.ready;
    const reg = this.registration;
    const gen = this.generation;
    if (this.stopped || reg === undefined) return result;
    // Off and nothing ever published: nothing to look at.
    if (reg === null && (await this.deps.backend.keys(NAMESPACE)).length === 0) return result;
    const live = () => {
      if (this.stopped || gen !== this.generation) throw new Superseded();
    };
    const groups = this.deps
      .groups()
      .filter((g) => !opts.groupIdHex || g.idHex === opts.groupIdHex);
    const mayPrompt = this.deps.silentSigner || opts.interactive;
    for (const group of groups) {
      if (this.stopped || gen !== this.generation) break;
      // One group's failure (a store read, a relay, the signer) never stops
      // the others; it stays pending for a later pass.
      try {
        const shared = await this.load(group.idHex);
        const action = planGroup(shared, reg, group);
        if (action.type === 'none') continue;
        if (action.type === 'forget') {
          await this.deps.backend.remove(NAMESPACE, group.idHex);
          continue;
        }
        if (action.type === 'resend') {
          live();
          if (shared && (await this.deps.send(group.idHex, tokenUpdateEvent(shared.record)))) {
            await this.save(group.idHex, { record: shared.record, leaves: [...group.leaves] });
          } else result.pending++;
          continue;
        }
        if (!mayPrompt || result.declined) {
          result.pending++;
          continue;
        }
        const done =
          action.type === 'remove'
            ? await this.retract(group, action.record, live)
            : await this.publish(group, reg as DeviceRegistration, action.replaces, shared, live);
        if (!done) result.pending++;
        else if (action.type === 'remove') result.removed++;
        else result.published++;
      } catch (e) {
        result.pending++;
        if (e instanceof Superseded) break;
        // A remote signer refusing, timing out or returning a bad signature:
        // stop asking it for the rest of this pass.
        const signerFailed = e instanceof SignerRefused || e instanceof OwnerProofMismatch;
        if (signerFailed && !this.deps.silentSigner) result.declined = true;
        if (__DEV__) console.warn('[MarmotPush] registration step failed:', e);
      }
    }
    return result;
  }

  /** The signer, with its failures marked as the user's refusal. */
  private readonly sign: Sign = (template) =>
    this.deps.sign(template).catch((e: unknown) => {
      throw new SignerRefused(e);
    });

  /** A stamp above anything we signed in this group (and above `after`). */
  private async nextTs(groupIdHex: string, after?: PushRecord): Promise<number> {
    const now = (this.deps.now ?? Date.now)();
    const highWater = Number((await this.deps.backend.get(TS_NAMESPACE, groupIdHex)) ?? 0) || 0;
    return Math.max(now, highWater + 1, (after?.ownerTs ?? 0) + 1);
  }

  /** Sign an entry — only while this pass is still current — and record
   * its stamp as the group's high-water mark before it can be published. */
  private async signLive<T extends Omit<PushRecord, 'ownerSig'> | Omit<Removal, 'ownerSig'>>(
    groupIdHex: string,
    entry: T,
    live: () => void,
  ): Promise<T & { ownerSig: string }> {
    live();
    const signed = await signEntry(entry, groupIdHex, this.sign);
    live();
    await this.deps.backend.set(TS_NAMESPACE, groupIdHex, String(entry.ownerTs));
    live(); // right before the caller publishes
    return signed;
  }

  private async retract(
    group: RegistrarGroup,
    record: PushRecord,
    live: () => void,
  ): Promise<boolean> {
    const ts = await this.nextTs(group.idHex, record);
    const removal = await this.signLive(group.idHex, removalFor(record, ts), live);
    if (!(await this.deps.send(group.idHex, tokenRemovalEvent(removal)))) return false;
    await this.deps.backend.remove(NAMESPACE, group.idHex);
    return true;
  }

  private async publish(
    group: RegistrarGroup,
    reg: DeviceRegistration,
    replaces: PushRecord | undefined,
    shared: Shared | null,
    live: () => void,
  ): Promise<boolean> {
    if (replaces && !(await this.retract(group, replaces, live))) return false;
    const previous = shared?.record.leaf === group.ownLeaf ? shared.record : undefined;
    const ts = await this.nextTs(group.idHex, previous);
    const unsigned = buildOwnRecord(reg, this.deps.pubkey, group.ownLeaf, ts);
    const record = await this.signLive(group.idHex, unsigned, live);
    if (!(await this.deps.send(group.idHex, tokenUpdateEvent(record)))) return false;
    await this.save(group.idHex, { record, leaves: [...group.leaves] });
    return true;
  }

  /** What we last published in the group; null when nothing. A failed
   * store read THROWS — planning from "nothing" would forget to retract. */
  private async load(groupIdHex: string): Promise<Shared | null> {
    const raw = await this.deps.backend.get(NAMESPACE, groupIdHex);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Shared;
      return parsed?.record && Array.isArray(parsed.leaves) ? parsed : null;
    } catch {
      return null;
    }
  }

  // Written even after stop(): it records a publish that already happened
  // (a later pass must know to retract it), and stop() resolves only once
  // the running pass — this write included — has finished, so an account
  // wipe waiting on it can't be overtaken.
  private async save(groupIdHex: string, shared: Shared): Promise<void> {
    await this.deps.backend.set(NAMESPACE, groupIdHex, JSON.stringify(shared));
  }
}
