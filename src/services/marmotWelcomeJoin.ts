// Serializes Welcome adoption: rumor ids differ for each invited slot, but
// one installation must hold only one leaf per group. The library rejects a
// group its registry already tracks ("already exists") — but only once the
// first join has been tracked, so concurrent joins of several Welcomes for
// one group all passed that check and the last one overwrote the membership
// (#1426's ghost leaves). Joining one at a time closes the race. The library's
// leave API operates on tracked state, so joining an extra leaf to SelfRemove
// it would overwrite the membership we are protecting. Ignore the extra Welcome.
//
// Duplicates are recognised WITHOUT crypto: the inviter sends one Welcome per
// invited key package, but every copy from one commit carries the same
// encrypted GroupInfo, so its sha256 (welcomeCommitFingerprint) identifies the
// group we joined from it. `readInviteGroupInfo` is not a cheap peek — in
// marmot-ts it runs the full ts-mls `joinGroup` — so it is never used ahead
// of a join; a Welcome from a later commit for a group we hold still fails
// inside the library ("already exists") and is classified in the catch path.
import type { MarmotClient, MarmotGroup, GroupRumorHistory } from '@internet-privacy/marmot-ts';

import type { MarmotRumor } from './marmotSession';
import type { MarmotKvBackend } from './marmotStore';
import { isPermanentWelcomeFailure, isWelcomeForJoinedGroup } from './marmotWelcomeFailure';
import {
  buildWelcomeOutcome,
  countWelcomeAttempt,
  forgetWelcomeAttempts,
  permanentFailureOutcome,
  welcomeCommitFingerprint,
  WELCOME_OUTCOMES_NS,
  type KeyPackageLookup,
  type WelcomeOutcome,
} from './marmotWelcomeOutcomes';

interface WelcomeJoinOptions {
  client: MarmotClient<GroupRumorHistory>;
  backend: MarmotKvBackend;
  stopped: () => boolean;
  onJoined: () => void;
  onFinished: () => void;
  keyPackageLookup: () => Promise<KeyPackageLookup>;
}

export class MarmotWelcomeJoin {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly joining = new Map<string, Promise<MarmotGroup<GroupRumorHistory> | null>>();
  /** Welcome commit fingerprint → group id joined from it (this session). */
  private readonly joinedCommits = new Map<string, string>();
  constructor(private readonly options: WelcomeJoinOptions) {}

  /** Cheap duplicate check: a copy of a Welcome whose group we already hold. */
  private joinedFromSameCommit(welcomeRumor: MarmotRumor): boolean {
    const commit = welcomeCommitFingerprint(welcomeRumor);
    const idHex = commit && this.joinedCommits.get(commit);
    return !!idHex && this.options.client.groups.loaded.some((g) => g.idStr === idHex);
  }

  private rememberJoined(welcomeRumor: MarmotRumor, idHex: string): void {
    const commit = welcomeCommitFingerprint(welcomeRumor);
    if (commit) this.joinedCommits.set(commit, idHex);
  }

  accept(welcomeRumor: MarmotRumor): Promise<MarmotGroup<GroupRumorHistory> | null> {
    const id = welcomeRumor.id;
    // The inbox, the resume scan and an approved invitation can deliver the
    // same Welcome at once. Later callers share the in-flight attempt rather
    // than queueing a redundant pass — and rather than getting an immediate
    // null, which marmotPendingInvitations would read (no outcome marker yet)
    // as a transient failure and park the approval until restart. Only
    // DISTINCT Welcomes queue; the guard is held from here until settled.
    const inFlight = this.joining.get(id);
    if (inFlight) return inFlight;
    const run = this.tail
      .then(() => this.join(welcomeRumor))
      .finally(() => this.joining.delete(id));
    this.joining.set(id, run);
    this.tail = run.catch(() => undefined); // a store failure must not block the queue
    return run;
  }

  private async join(welcomeRumor: MarmotRumor): Promise<MarmotGroup<GroupRumorHistory> | null> {
    // Each Welcome is joined at most once: inbox refreshes re-surface the
    // same gift wrap, and re-joining must never reset a group we already
    // hold. The marker is written on success or a PERMANENT failure only —
    // a transient error (relay / store) leaves the invite retryable.
    if (this.options.stopped()) return null;
    const id = welcomeRumor.id;
    const ns = WELCOME_OUTCOMES_NS;
    if (await this.options.backend.get(ns, id)) return null;
    if (this.options.stopped()) return null; // signed out during the read
    // The marker records what happened, so the inbox can hide or explain it.
    const markHandled = async (outcome: WelcomeOutcome) => {
      await this.options.backend.set(ns, id, JSON.stringify(outcome));
      await this.options.backend.remove('pendingWelcomes', id);
      await forgetWelcomeAttempts(this.options.backend, id);
    };
    try {
      // Durable until joined or permanently rejected: the inbox stores the
      // invite's gift wrap as processed and never re-routes it, so a transient
      // failure is retried on start, resume, or relay reconnect instead
      // (marmotPendingWelcomes).
      await this.options.backend.set('pendingWelcomes', id, JSON.stringify(welcomeRumor));
      if (this.options.stopped()) return null;
      if (this.joinedFromSameCommit(welcomeRumor)) {
        await markHandled(buildWelcomeOutcome(welcomeRumor, 'joined'));
        if (__DEV__) console.log('[Marmot] ignored duplicate group Welcome');
        return null;
      }
      const { group } = await this.options.client.joinGroupFromWelcome({ welcomeRumor });
      this.rememberJoined(welcomeRumor, group.idStr);
      this.options.onJoined(); // the key is spent, even if outcome persistence fails
      await markHandled(buildWelcomeOutcome(welcomeRumor, 'joined'));
      if (__DEV__) console.log(`[Marmot] joined ${group.idStr.slice(0, 8)} from welcome`);
      return group;
    } catch (e) {
      // Permanent = no key we hold opens it (another device's / a deleted key).
      const joined = await isWelcomeForJoinedGroup(this.options.client, welcomeRumor);
      const permanent =
        joined ||
        (await isPermanentWelcomeFailure(this.options.client.keyPackages, welcomeRumor, e));
      if (joined) await markHandled(buildWelcomeOutcome(welcomeRumor, 'joined'));
      else if (permanent) {
        const lookup = await this.options.keyPackageLookup();
        await markHandled(await permanentFailureOutcome(welcomeRumor, e, lookup));
      } else await countWelcomeAttempt(this.options.backend, id);
      if (__DEV__) {
        const kp = welcomeRumor.tags.find((t) => t[0] === 'e')?.[1]?.slice(0, 12);
        console.warn(`[Marmot] welcome for key package ${kp} failed (permanent: ${permanent}):`, e);
      }
      return null;
    } finally {
      this.options.onFinished(); // accept() releases the per-Welcome guard
    }
  }
}
