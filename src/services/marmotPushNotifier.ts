// Per-account MIP-05 push state: remembers each group's verified push-token
// records (from members' 447/448/449 events) and, after we send a message,
// wakes the other members' devices via their notification servers. Pure
// protocol rules live in marmotPush.ts; this adds persistence (the encrypted
// marmot_kv store) and publishing. Always best-effort — a failure here never
// touches message delivery.

import type { NostrNetworkInterface } from '@internet-privacy/marmot-ts';

import { createYieldScheduler } from '../contexts/nostrDecryptPacing';
import {
  applyPushPayload,
  buildTriggerWraps,
  pruneToLeaves,
  selectTriggerTargets,
  type PushRecordState,
} from './marmotPush';
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
  // One write chain per group so overlapping events can't lose each other.
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly deps: {
      pubkey: string;
      backend: MarmotKvBackend;
      network: Pick<NostrNetworkInterface, 'publish' | 'getUserInboxRelays'>;
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

  /** Wake the group's other members after we sent a message. Fire-and-forget. */
  async trigger(group: PushGroup): Promise<void> {
    const state = await this.load(group.idHex);
    const targets = selectTriggerTargets(state, this.deps.pubkey, group.leaves);
    await Promise.all(
      targets.map(async ({ server, relayHints, tokens }) => {
        // Spec: the records' relay hints, else the server's inbox (10050) relays.
        const relays = relayHints.length
          ? relayHints
          : await this.deps.network.getUserInboxRelays(server).catch(() => []);
        if (relays.length === 0) return;
        for (const wrap of buildTriggerWraps(server, tokens)) {
          await this.deps.network.publish(relays, wrap).catch(() => undefined);
        }
        if (__DEV__) {
          console.log(`[Marmot] push trigger → ${server.slice(0, 8)} (${tokens.length} device(s))`);
        }
      }),
    );
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
    this.cache.set(groupId, state);
    await this.deps.backend.set(NAMESPACE, groupId, JSON.stringify(state));
  }
}
