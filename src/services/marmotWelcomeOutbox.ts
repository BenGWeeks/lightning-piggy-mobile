// Invitations (Welcomes) that no relay accepted, kept so they can be sent
// again WITHOUT another Add commit and without asking the signer again.
//
// A Welcome reaches each invited device as a NIP-59 gift wrap that is fully
// signed (by a throwaway key) before it's published, so republishing the
// very same event later is a valid retry. The Add commit has already made
// the person a member — re-inviting them isn't possible (they're filtered
// out as "already a member") and wouldn't be needed: only delivery failed.
//
// Lifecycle: the session's network publish is wrapped so failed gift wraps
// are captured while an invite runs; the invite retries them once straight
// away, then persists what's still undelivered here and retries at every
// session start until a relay accepts it or it expires.

import type { NostrNetworkInterface } from '@internet-privacy/marmot-ts';
import type { Event as NostrEvent } from 'nostr-tools';

import type { MarmotKvBackend } from './marmotStore';

const GIFT_WRAP_KIND = 1059;
const OUTBOX_NS = 'welcomeOutbox';
/** Give up after this long — the invited key package will have rotated. */
export const WELCOME_OUTBOX_TTL_SECS = 14 * 24 * 60 * 60;
/** Bound on stored wraps (oldest dropped first). */
const OUTBOX_MAX = 100;

export interface PendingWelcome {
  /** The signed kind-1059 gift wrap, ready to republish. */
  event: NostrEvent;
  /** The recipient's inbox relays it was meant for. */
  relays: string[];
  /** Recipient account (the wrap's `p`). */
  recipient: string;
  /** MLS group id (hex) it invites to. */
  groupIdHex: string;
  queuedAt: number;
}

type Publish = NostrNetworkInterface['publish'];
type CapturedWrap = Pick<PendingWelcome, 'event' | 'relays' | 'recipient'>;

const accepted = (res: Awaited<ReturnType<Publish>>) => Object.values(res).some((r) => r.ok);
const recipientOf = (e: NostrEvent) => e.tags.find((t) => t[0] === 'p')?.[1]?.toLowerCase() ?? '';

export class MarmotWelcomeOutbox {
  private readonly captures = new Set<{ failed: CapturedWrap[]; onWrap?: () => void }>();
  private publishRaw: Publish | null = null;
  /** Captures run one at a time: gift wraps are encrypted, so a failed one
   * can't be traced to its group — two invites at once would swap them. */
  private captureChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly backend: MarmotKvBackend) {}

  /** The network with its publish observed: failed gift wraps are captured
   * (while an invite runs) and every wrap reports progress. */
  wrapNetwork<N extends Pick<NostrNetworkInterface, 'publish'>>(network: N): N {
    const publish = network.publish.bind(network) as Publish;
    this.publishRaw = publish;
    return {
      ...network,
      publish: async (relays: string[], event: NostrEvent) => {
        const res = await publish(relays, event);
        if (event.kind === GIFT_WRAP_KIND && this.captures.size > 0) {
          const ok = accepted(res);
          for (const c of this.captures) {
            if (!ok) c.failed.push({ event, relays, recipient: recipientOf(event) });
            c.onWrap?.();
          }
        }
        return res;
      },
    } as N;
  }

  /** Run `fn` (after any capture already running), collecting the gift
   * wraps no relay accepted meanwhile. */
  capture<T>(
    fn: () => Promise<T>,
    onWrap?: () => void,
  ): Promise<{ result: T; failed: CapturedWrap[] }> {
    const run = this.captureChain.then(async () => {
      const c = { failed: [] as CapturedWrap[], onWrap };
      this.captures.add(c);
      try {
        return { result: await fn(), failed: c.failed };
      } finally {
        this.captures.delete(c);
      }
    });
    this.captureChain = run.catch(() => undefined);
    return run;
  }

  /** Republish each wrap once; returns those still not accepted. */
  async resend<W extends CapturedWrap>(wraps: W[]): Promise<W[]> {
    const publish = this.publishRaw;
    if (!publish) return wraps;
    const results = await Promise.all(
      wraps.map((w) => publish(w.relays, w.event).then(accepted, () => false)),
    );
    return wraps.filter((_, i) => !results[i]);
  }

  /** Keep undelivered wraps for retry at the next session start. */
  async enqueue(groupIdHex: string, wraps: CapturedWrap[]): Promise<void> {
    const queuedAt = Math.floor(Date.now() / 1000);
    for (const w of wraps) {
      const item: PendingWelcome = { ...w, groupIdHex, queuedAt };
      await this.backend.set(OUTBOX_NS, w.event.id, JSON.stringify(item));
    }
    if ((await this.backend.keys(OUTBOX_NS)).length <= OUTBOX_MAX) return;
    const oldestFirst = (await this.pending()).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const item of oldestFirst.slice(0, oldestFirst.length - OUTBOX_MAX)) {
      await this.backend.remove(OUTBOX_NS, item.event.id);
    }
  }

  /** Forget a group's queued wraps (the group was destroyed / left). */
  async drop(groupIdHex: string): Promise<void> {
    for (const item of await this.pending()) {
      if (item.groupIdHex === groupIdHex) await this.backend.remove(OUTBOX_NS, item.event.id);
    }
  }

  /** Retry every queued wrap; delivered and expired ones are removed. */
  async flush(isStopped: () => boolean = () => false): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    for (const item of await this.pending()) {
      if (isStopped()) return;
      const expired = now - item.queuedAt > WELCOME_OUTBOX_TTL_SECS;
      if (expired || (await this.resend([item])).length === 0) {
        await this.backend.remove(OUTBOX_NS, item.event.id);
      }
    }
  }

  async pending(): Promise<PendingWelcome[]> {
    const items: PendingWelcome[] = [];
    for (const id of await this.backend.keys(OUTBOX_NS)) {
      const raw = await this.backend.get(OUTBOX_NS, id);
      try {
        if (raw) items.push(JSON.parse(raw) as PendingWelcome);
      } catch {
        await this.backend.remove(OUTBOX_NS, id);
      }
    }
    return items;
  }
}
