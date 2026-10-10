// Shared fixtures for the MarmotSession suites: one in-memory relay every
// client talks to, Nostr signers, sessions (and extra installs of the same
// account), and the inbox path's Welcome unwrap. Test-only.
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  matchFilters,
  nip44,
  nip59,
} from 'nostr-tools';
import type { Event as NostrEvent, Filter } from 'nostr-tools';

import { MarmotSession, type MarmotMessageEvent, type MarmotRumor } from './marmotSession';
import { createMemoryMarmotBackend } from './marmotStore';

export const RELAY = 'wss://relay.test';

/** One in-memory relay shared by every client in the test. */
export function makeRelay() {
  const events: NostrEvent[] = [];
  const requests: Filter[][] = [];
  const subs = new Set<{ filters: Filter[]; next: (e: NostrEvent) => void }>();
  const asArray = (f: Filter | Filter[]) => (Array.isArray(f) ? f : [f]);
  return {
    events,
    requests,
    network: {
      async publish(relays: string[], event: NostrEvent) {
        events.push(event);
        for (const s of subs) if (matchFilters(s.filters, event)) s.next(event);
        return Object.fromEntries(relays.map((r) => [r, { from: r, ok: true }]));
      },
      async request(_relays: string[], filters: Filter | Filter[]) {
        requests.push(asArray(filters));
        // Like a real relay: per filter, newest-first, `until`-bounded, `limit`-capped.
        return asArray(filters).flatMap((f) =>
          events
            .filter(
              (e) => matchFilters([f], e) && (f.until === undefined || e.created_at <= f.until),
            )
            .sort((x, y) => y.created_at - x.created_at)
            .slice(0, f.limit ?? Infinity),
        );
      },
      subscription(_relays: string[], filters: Filter | Filter[]) {
        return {
          subscribe(observer: { next?: (e: NostrEvent) => void }) {
            const sub = { filters: asArray(filters), next: (e: NostrEvent) => observer.next?.(e) };
            subs.add(sub);
            for (const e of events) if (matchFilters(sub.filters, e)) sub.next(e);
            return { unsubscribe: () => subs.delete(sub) };
          },
        };
      },
      async getUserInboxRelays() {
        return [RELAY];
      },
    },
  };
}

export function makeSigner() {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return {
    pubkey,
    sk,
    signer: {
      getPublicKey: () => pubkey,
      signEvent: (draft: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(draft, sk),
      nip44: {
        encrypt: (pk: string, pt: string) => nip44.encrypt(pt, nip44.getConversationKey(sk, pk)),
        decrypt: (pk: string, ct: string) => nip44.decrypt(ct, nip44.getConversationKey(sk, pk)),
      },
    },
  };
}

export async function waitFor(cond: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function makeSession(
  relay: ReturnType<typeof makeRelay>,
  pageSize?: number,
  signerType: 'nsec' | 'amber' = 'nsec',
) {
  const who = makeSigner();
  const inbox: MarmotMessageEvent[] = [];
  const backend = createMemoryMarmotBackend();
  const session = new MarmotSession({
    pubkey: who.pubkey,
    signerType,
    signer: who.signer,
    network: relay.network,
    backend,
    getWriteRelays: () => [RELAY],
    getLookupRelays: () => [RELAY],
    groupBackfillPageSize: pageSize,
  });
  session.subscribe({ onMessage: (m) => inbox.push(m) });
  return { ...who, session, inbox, backend };
}

/** Another install of an existing account: same key, its own device state. */
export function makeInstall(
  relay: ReturnType<typeof makeRelay>,
  who: ReturnType<typeof makeSigner>,
) {
  const inbox: MarmotMessageEvent[] = [];
  const session = new MarmotSession({
    pubkey: who.pubkey,
    signerType: 'nsec',
    signer: who.signer,
    network: relay.network,
    backend: createMemoryMarmotBackend(),
    getWriteRelays: () => [RELAY],
    getLookupRelays: () => [RELAY],
  });
  session.subscribe({ onMessage: (m) => inbox.push(m) });
  return { ...who, session, inbox };
}

/** What the NIP-17 inbox path does for a kind-1059 Welcome: unwrap → rumor. */
export function unwrapWelcomes(
  relay: ReturnType<typeof makeRelay>,
  who: { pubkey: string; sk: Uint8Array },
) {
  return relay.events
    .filter((e) => e.kind === 1059 && e.tags.some((t) => t[0] === 'p' && t[1] === who.pubkey))
    .map((w) => nip59.unwrapEvent(w, who.sk) as unknown as MarmotRumor)
    .filter((r) => r.kind === 444);
}
