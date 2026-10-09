// Per-account MIP-05 push state: remembers each group's verified push-token
// records (from members' 447/448/449 events) and, after we send a message,
// wakes the other members' devices via their notification servers. Pure
// protocol rules live in marmotPush.ts; this adds persistence (the encrypted
// marmot_kv store) and publishing. Always best-effort — a failure here never
// touches message delivery.

import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import {
  applyPushPayload,
  buildTriggerWraps,
  pruneToLeaves,
  selectTriggerTargets,
  type PushRecordState,
  type TriggerTarget,
} from './marmotPush';
import type { PushTransport } from './marmotNetwork';
import type { MarmotKvBackend } from './marmotStore';

const NAMESPACE = 'pushRecords';

export interface PushGroup {
  /** MLS group id: hex (storage key + owner-proof binding) and raw bytes. */
  idHex: string;
  id: Uint8Array;
  /** Current leaves as "member|leafIndex" — records of other leaves are dropped. */
  leaves: Set<string>;
}

export class MarmotPushNotifier {
  private readonly cache = new Map<string, PushRecordState>();
  // Every read and write of a group's state runs on one chain, so a trigger
  // can't select from a state an earlier event is still updating, and a cold
  // load can't overwrite a newer cached state.
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  // Set on session teardown: no more writes (a wipe must not be undone by a
  // late ingest) and no more publishes.
  private stopped = false;

  constructor(
    private readonly deps: {
      pubkey: string;
      backend: MarmotKvBackend;
      transport: PushTransport;
    },
  ) {}

  /** Apply a received 447/448/449 payload (advisory; bad entries dropped). */
  ingest(group: PushGroup, kind: number, content: string): Promise<void> {
    return this.serial(group.idHex, async () => {
      const scheduler = createYieldScheduler({ safetyEvery: 8 });
      try {
        const state = await applyPushPayload(
          await this.load(group.idHex),
          kind,
          content,
          group,
          Date.now(),
          scheduler.maybeYield,
        );
        await this.save(group.idHex, pruneToLeaves(state, group.leaves));
      } finally {
        scheduler.dispose();
      }
    });
  }

  /** After a membership change: forget records and tombstones of leaves that
   * left, so a later occupant of the same leaf index starts clean. */
  reconcile(group: PushGroup): Promise<void> {
    return this.serial(group.idHex, async () => {
      const state = await this.load(group.idHex);
      const pruned = pruneToLeaves(state, group.leaves);
      if (Object.keys(pruned).length !== Object.keys(state).length) {
        await this.save(group.idHex, pruned);
      }
    });
  }

  /**
   * Wake the group's other members after we sent a message. Selection runs on
   * the group's chain; building + publishing the wraps happens off it, on a
   * later macrotask and yielding between wraps, so it never delays the send.
   */
  trigger(group: PushGroup): void {
    if (this.stopped) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.stopped) return;
      void this.serial(group.idHex, async () =>
        selectTriggerTargets(await this.load(group.idHex), this.deps.pubkey, group.leaves),
      )
        .then((targets) => this.publish(targets))
        .catch(() => undefined);
    }, 0);
    this.timers.add(timer);
  }

  /**
   * Stop for good: cancel queued triggers, refuse further writes/publishes,
   * and resolve once every queued state task has settled — so the caller can
   * wipe this account's storage without a late ingest re-creating rows.
   */
  stop(): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    return Promise.all(this.chains.values()).then(() => undefined);
  }

  private async publish(targets: TriggerTarget[]): Promise<void> {
    if (targets.length === 0) return;
    const scheduler = createYieldScheduler({ safetyEvery: 1 });
    try {
      for (const { server, relayHints, tokens } of targets) {
        if (this.stopped) return;
        // Spec publish targets: the records' relay hints, else the server's
        // own 10050 inbox — never a default relay.
        const relays = relayHints.length
          ? relayHints
          : await this.deps.transport.inboxRelays(server).catch(() => []);
        if (relays.length === 0) continue;
        // One server's failure (e.g. wrap encryption throwing) must not cost
        // the other servers their triggers.
        try {
          for (const wrap of buildTriggerWraps(server, tokens)) {
            if (this.stopped) return;
            await this.deps.transport.publish(relays, wrap).catch(() => undefined);
            await scheduler.maybeYield();
          }
        } catch {
          continue;
        }
        if (__DEV__) {
          console.log(`[Marmot] push trigger → ${server.slice(0, 8)} (${tokens.length} device(s))`);
        }
      }
    } finally {
      scheduler.dispose();
    }
  }

  private serial<T>(groupId: string, task: () => Promise<T>): Promise<T> {
    const run = (this.chains.get(groupId) ?? Promise.resolve()).then(task, task);
    this.chains.set(
      groupId,
      run.catch(() => undefined),
    );
    return run;
  }

  private async load(groupId: string): Promise<PushRecordState> {
    const cached = this.cache.get(groupId);
    if (cached) return cached;
    const raw = await this.deps.backend.get(NAMESPACE, groupId).catch(() => null);
    let state: PushRecordState = {};
    try {
      state = raw ? (JSON.parse(raw) as PushRecordState) : {};
    } catch {
      state = {};
    }
    this.cache.set(groupId, state);
    return state;
  }

  private async save(groupId: string, state: PushRecordState): Promise<void> {
    if (this.stopped) return;
    this.cache.set(groupId, state);
    await this.deps.backend.set(NAMESPACE, groupId, JSON.stringify(state));
  }
}
