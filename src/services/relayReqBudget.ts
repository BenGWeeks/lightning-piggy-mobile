import { finishAfterRelayReceive } from './nostrRelayReceiveQueue';
import { PERF_LOGS_ENABLED } from '../utils/perfLog';
import type { Filter } from 'nostr-tools/filter';

export const DEFAULT_RELAY_REQ_BUDGET = 10;
export const REQ_TIMEOUT_MS = 20_000;
export const REQ_STALL_MS = 15_000;
export type ReqOptions = { mode: 'live' | 'oneshot'; label: string; timeoutMs?: number };
export const reqPriority = (filters: Filter[]): number =>
  filters.some((f) => f.kinds?.some((k) => k === 1059 || k === 4))
    ? 0
    : filters.some(
          (f) => f.kinds?.includes(30443) || (f.kinds?.includes(445) && f.until === undefined),
        )
      ? 1
      : 2;
export function reqLabel(filters: Filter[], mode: ReqOptions['mode']): string {
  if (filters.some((f) => f.kinds?.includes(30443))) return 'welcome-key';
  if (filters.some((f) => f.kinds?.includes(445)))
    return mode === 'live'
      ? 'live-group'
      : filters.some((f) => f.until !== undefined)
        ? 'backfill'
        : 'group-state';
  if (reqPriority(filters) === 0) return mode === 'live' ? 'live-inbox' : 'inbox-fetch';
  if (filters.some((f) => f.kinds?.includes(0))) return 'profile';
  if (filters.some((f) => f.kinds?.includes(7))) return 'reaction';
  if (filters.some((f) => f.kinds?.includes(39000) || f.kinds?.includes(39001))) return 'market';
  return `${mode}-${filters.flatMap((f) => f.kinds ?? []).join(',') || 'event'}`;
}
export const isReqLimitError = (reason: string): boolean =>
  /too many.*(?:req|sub)|max.*subscriptions|subscription.*limit|rate-limited:/i.test(reason);

// Retain inbox + merged groups even at small limits, reserving up to three
// one-shot slots where possible. At limits 1–2, one-shots pause a live owner.
export const liveReqCap = (max: number): number => Math.max(Math.min(2, max), max - 3);
type Task = {
  priority: number;
  options: ReqOptions;
  start: () => { close: (reason?: string) => void };
  sub?: { close: (reason?: string) => void };
  cancelled: boolean;
  attempts: number;
  readyAt: number;
  queuedAt: number;
  deadline?: number;
  expiring?: boolean;
  onDispose: (reason: string) => void;
};

/** One scheduler per relay/socket; interrupted owners retain their original deadlines. */
export class RelayReqBudget {
  private tasks = new Set<Task>();
  private timer?: ReturnType<typeof setTimeout>;
  private draining = false;
  private disposed = false;
  private stalled = false;
  constructor(
    readonly url: string,
    private max = DEFAULT_RELAY_REQ_BUDGET,
  ) {}

  setMax(max: number): void {
    if (!Number.isInteger(max) || max < 1) return;
    this.max = max;
    while (this.open > max || this.liveOpen > liveReqCap(max)) {
      const victim = [...this.tasks]
        .filter((t) => t.sub && t.options.mode === 'live')
        .sort((a, b) => b.priority - a.priority)[0];
      if (victim) this.pause(victim);
      else {
        const shot = [...this.tasks].find((t) => t.sub)!;
        // NIP-11 arrives asynchronously, after reads may have opened. Requeue
        // without notifying the owner: no response has established EOSE yet.
        this.pause(shot);
      }
    }
    this.drain();
  }
  restrictMax(max: number): void {
    this.setMax(Math.min(this.max, max));
  }
  get open(): number {
    return [...this.tasks].filter((t) => t.sub).length;
  }
  private get liveOpen(): number {
    return [...this.tasks].filter((t) => t.sub && t.options.mode === 'live').length;
  }

  add(
    priority: number,
    start: Task['start'],
    onDispose: Task['onDispose'] = () => {},
    options: ReqOptions = { mode: 'live', label: 'live' },
  ) {
    const task: Task = {
      priority,
      start,
      options,
      cancelled: false,
      attempts: 0,
      readyAt: 0,
      queuedAt: Date.now(),
      onDispose,
    };
    if (options.mode === 'oneshot')
      task.deadline = Date.now() + Math.min(options.timeoutMs ?? REQ_TIMEOUT_MS, REQ_TIMEOUT_MS);
    const close = (reason = 'closed by caller') => {
      this.finish(task, reason, false);
      this.drain();
    };
    if (this.disposed) {
      task.cancelled = true;
      onDispose('pool closed');
    } else {
      this.tasks.add(task);
      this.drain();
    }
    return {
      close,
      retry: () => {
        if (task.cancelled) return;
        task.readyAt = Date.now() + Math.min(30_000, 1000 * 2 ** task.attempts++);
        this.pause(task);
        this.max = Math.max(1, Math.min(this.max, this.open));
        this.setMax(this.max);
      },
    };
  }

  notice(reason: string): void {
    if (!isReqLimitError(reason)) return;
    const active = [...this.tasks].filter((t) => t.sub);
    this.max = Math.max(1, Math.min(this.max - 1, active.length - 1));
    for (const task of active) {
      task.readyAt = Date.now() + Math.min(30_000, 1000 * 2 ** task.attempts++);
      this.pause(task);
    }
    this.drain();
  }
  dispose(reason = 'pool closed'): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const task of [...this.tasks]) this.finish(task, reason);
  }
  private finish(task: Task, reason: string, notify = true): void {
    if (task.cancelled) return;
    task.cancelled = true;
    this.tasks.delete(task);
    try {
      this.pause(task, reason);
    } finally {
      if (notify) task.onDispose(reason);
    }
  }
  private pause(task: Task, reason = 'budget pause'): void {
    const sub = task.sub;
    task.sub = undefined;
    task.queuedAt = Date.now();
    sub?.close(reason);
  }
  private drain(): void {
    if (this.draining || this.disposed) return;
    this.draining = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      const now = Date.now();
      const waiting = [...this.tasks].filter((t) => !t.sub && !t.cancelled && !t.expiring);
      const oldest = waiting.sort((a, b) => a.queuedAt - b.queuedAt)[0];
      const atCap =
        this.open >= this.max ||
        (oldest?.options.mode === 'live' && this.liveOpen >= liveReqCap(this.max));
      if (oldest && atCap && now - oldest.queuedAt >= REQ_STALL_MS) {
        if (!this.stalled) {
          const holders = new Map<string, number>();
          for (const t of this.tasks)
            if (t.sub) holders.set(t.options.label, (holders.get(t.options.label) ?? 0) + 1);
          console.warn(
            `[Relay] budget stall ${this.url} open=${this.open}/${this.max} queued=${waiting.length} oldest=${oldest.options.label} ${Math.floor((now - oldest.queuedAt) / 1000)}s holders: ${[...holders].map(([label, n]) => `${label}×${n}`).join(' ')}`,
          );
        }
        this.stalled = true;
      } else this.stalled = false;
      for (const t of [...this.tasks])
        if (t.deadline !== undefined && now >= t.deadline) {
          console.warn(`[Relay] budget timeout ${this.url} label=${t.options.label}`);
          // Keep the physical REQ and slot alive until pre-deadline events
          // have been delivered. Clear the deadline to enqueue only one marker.
          t.deadline = undefined;
          t.expiring = true;
          finishAfterRelayReceive(() => {
            this.finish(t, 'query deadline');
            this.drain();
          });
        }
      waiting.sort((a, b) => a.priority - b.priority);
      for (const task of waiting) {
        if (task.cancelled || task.expiring || task.readyAt > now) continue;
        const live = task.options.mode === 'live';
        if (this.open >= this.max || (live && this.liveOpen >= liveReqCap(this.max))) {
          const victim = [...this.tasks]
            .filter(
              (t) =>
                t.sub &&
                t.options.mode === 'live' &&
                (t.priority > task.priority || (!live && liveReqCap(this.max) === this.max)),
            )
            .sort((a, b) => b.priority - a.priority)[0];
          if (!victim) continue;
          this.pause(victim);
        }
        // Reserve the slot before start: synchronous EOSE/errors can close it.
        task.sub = { close: () => {} };
        try {
          const sub = task.start();
          if (task.cancelled || !task.sub) sub.close('request already finished');
          else task.sub = sub;
        } catch (error) {
          this.finish(task, String(error));
        }
      }
      if ([...this.tasks].some((t) => (!t.sub && !t.expiring) || t.deadline !== undefined))
        this.timer = setTimeout(() => this.drain(), 1000);
      if (PERF_LOGS_ENABLED)
        console.log(
          `[Relay] budget ${this.url} open=${this.open}/${this.max} queued=${this.tasks.size - this.open}`,
        );
    } finally {
      this.draining = false;
    }
  }
}
