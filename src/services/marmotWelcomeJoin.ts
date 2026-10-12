// Serializes Welcome adoption: rumor ids differ for each invited slot, but
// one installation must hold only one leaf per group. The library adopts
// state without rejecting a group it already tracks. Its leave API operates
// on that tracked state, so joining an extra leaf to SelfRemove it would
// overwrite the membership we are protecting. Ignore the extra Welcome.
import type { MarmotClient, MarmotGroup, GroupRumorHistory } from '@internet-privacy/marmot-ts';

import type { MarmotRumor } from './marmotSession';
import type { MarmotKvBackend } from './marmotStore';
import { isPermanentWelcomeFailure, isWelcomeForJoinedGroup } from './marmotWelcomeFailure';
import {
  buildWelcomeOutcome,
  countWelcomeAttempt,
  forgetWelcomeAttempts,
  permanentFailureOutcome,
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
  private readonly joiningWelcomes = new Set<string>();
  constructor(private readonly options: WelcomeJoinOptions) {}

  accept(welcomeRumor: MarmotRumor): Promise<MarmotGroup<GroupRumorHistory> | null> {
    const run = this.tail.then(() => this.join(welcomeRumor));
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
    if (this.joiningWelcomes.has(id) || (await this.options.backend.get(ns, id))) return null;
    this.joiningWelcomes.add(id);
    // The marker records what happened, so the inbox can hide or explain it.
    const markHandled = async (outcome: WelcomeOutcome) => {
      await this.options.backend.set(ns, id, JSON.stringify(outcome));
      await this.options.backend.remove('pendingWelcomes', id);
      await forgetWelcomeAttempts(this.options.backend, id);
    };
    try {
      // Durable until joined or permanently rejected: the inbox stores the
      // invite's gift wrap as processed and never re-routes it, so a transient
      // failure is retried from here (next session start) instead. Inside the
      // try so a failed write still releases `joiningWelcomes`.
      await this.options.backend.set('pendingWelcomes', id, JSON.stringify(welcomeRumor));
      if (this.options.stopped()) return null;
      if (await isWelcomeForJoinedGroup(this.options.client, welcomeRumor)) {
        await markHandled(buildWelcomeOutcome(welcomeRumor, 'joined'));
        if (__DEV__) console.log('[Marmot] ignored duplicate group Welcome');
        return null;
      }
      if (this.options.stopped()) return null;
      const { group } = await this.options.client.joinGroupFromWelcome({ welcomeRumor });
      await markHandled(buildWelcomeOutcome(welcomeRumor, 'joined'));
      if (__DEV__) console.log(`[Marmot] joined ${group.idStr.slice(0, 8)} from welcome`);
      this.options.onJoined(); // the joined key package is now spent
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
      this.joiningWelcomes.delete(id);
      this.options.onFinished();
    }
  }
}
