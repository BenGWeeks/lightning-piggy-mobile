import { DeletionLedger, type MarmotDeletion } from './marmotDeletions';
import {
  deletedMarmotMessages,
  marmotMessageKey,
  rememberMarmotDeletions,
  type MarmotMessageKey,
} from './marmotDeletionStore';
import { retractMarmotMessageNotifications, type MarmotMessageRef } from './notificationService';

/** A deletion sent at most this long before the session opened counts as live. */
const LIVE_SKEW_SEC = 120;
/** Live tray dismissals coalesce over one flush window. */
const LIVE_DISMISS_MS = 150;
/** Replayed deletions get one tray sweep once the replay goes quiet (the
 * stagger the AppState rules use for non-urgent work). */
const REPLAY_SWEEP_MS = 3000;

type Pending = { scope: string; deletion: MarmotDeletion };

/**
 * One inbound hook's view of Marmot "delete for everyone": what's been
 * deleted (session ledger + not-yet-written deletions + durable tombstones),
 * and retracting the notifications those deletions cover. Shared by the 1:1
 * (useMarmotDmInbound) and group (useMarmotGroups) paths; one instance per
 * hook mount, owned by one account.
 *
 * Perf (startup replay re-delivers every past deletion): incoming rows are
 * checked against tombstones in ONE query per flush (`filterLive`), and the
 * OS tray is only queried for live deletions (coalesced) plus a single sweep
 * after the replay — never once per replayed deletion.
 */
export class MarmotDeletionTracker {
  private readonly ledger = new DeletionLedger();
  /** Deletions noted but not yet durable — never evicted, so a flood of later
   * deletions can't erase one before it's written. */
  private pending: Pending[] = [];
  private pendingLedger = new DeletionLedger(Infinity);
  private readonly writing = new Set<DeletionLedger>();
  private liveRefs: MarmotMessageRef[] = [];
  private sweepRefs: MarmotMessageRef[] = [];
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly owner: string,
    private readonly openedAtSec: number,
  ) {}

  /** Record a deletion as it arrives (`createdAt` = the deletion's timestamp). */
  note(scope: string, deletion: MarmotDeletion, createdAt: number): void {
    this.ledger.add(deletion, scope);
    this.pendingLedger.add(deletion, scope);
    this.pending.push({ scope, deletion });
    const sender = deletion.anyAuthor ? null : deletion.deleter;
    const refs = deletion.targets.map((messageId) => ({
      owner: this.owner,
      groupId: scope,
      messageId,
      sender,
    }));
    // Cancel notifications still being created now (in memory, no tray query).
    void retractMarmotMessageNotifications(refs, { tray: false });
    if (createdAt >= this.openedAtSec - LIVE_SKEW_SEC) {
      this.liveRefs.push(...refs);
      this.liveTimer ??= setTimeout(() => this.dismiss('live'), LIVE_DISMISS_MS);
    } else {
      this.sweepRefs.push(...refs);
      if (this.sweepTimer) clearTimeout(this.sweepTimer);
      this.sweepTimer = setTimeout(() => this.dismiss('sweep'), REPLAY_SWEEP_MS);
    }
  }

  /** Synchronous: has this session seen a valid deletion of the message? */
  blocks(scope: string, id: string, sender: string): boolean {
    if (this.ledger.blocks(id, sender, scope) || this.pendingLedger.blocks(id, sender, scope))
      return true;
    for (const batch of this.writing) if (batch.blocks(id, sender, scope)) return true;
    return false;
  }

  /** Make every deletion noted so far durable. Run at the start of a flush,
   * before its rows are tested. On failure they stay pending for the next. */
  async persist(): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    const batchLedger = this.pendingLedger;
    this.pending = [];
    this.pendingLedger = new DeletionLedger(Infinity);
    this.writing.add(batchLedger);
    try {
      await rememberMarmotDeletions(this.owner, batch);
    } catch (e) {
      this.pending = [...batch, ...this.pending];
      for (const { scope, deletion } of batch) this.pendingLedger.add(deletion, scope);
      throw e;
    } finally {
      this.writing.delete(batchLedger);
    }
  }

  /** `items` minus the deleted ones — one tombstone query for the batch. */
  async filterLive<T>(items: readonly T[], keyOf: (item: T) => MarmotMessageKey): Promise<T[]> {
    const unseen = items.filter((item) => {
      const k = keyOf(item);
      return !this.blocks(k.scope, k.id, k.sender);
    });
    if (unseen.length === 0) return unseen;
    const deleted = await deletedMarmotMessages(this.owner, unseen.map(keyOf));
    return unseen.filter((item) => {
      const k = keyOf(item);
      return !deleted.has(marmotMessageKey(k.scope, k.id));
    });
  }

  /** For a notification about to be scheduled: deleted by now? */
  async isDeleted(scope: string, id: string, sender: string): Promise<boolean> {
    if (this.blocks(scope, id, sender)) return true;
    return (await deletedMarmotMessages(this.owner, [{ scope, id, sender }])).size > 0;
  }

  /** Stop timers; any queued tray dismissals run now. */
  dispose(): void {
    this.dismiss('live');
    this.dismiss('sweep');
  }

  private dismiss(which: 'live' | 'sweep'): void {
    if (which === 'live') {
      if (this.liveTimer) clearTimeout(this.liveTimer);
      this.liveTimer = null;
    } else {
      if (this.sweepTimer) clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
    const refs = which === 'live' ? this.liveRefs : this.sweepRefs;
    if (which === 'live') this.liveRefs = [];
    else this.sweepRefs = [];
    if (refs.length > 0) void retractMarmotMessageNotifications(refs, { tray: true });
  }
}
