// Manual Refresh of this phone's invitation key (#1236), built on the
// session's single-flight key-package run and #1230's acceptance tracking.
import { finalizeEvent, generateSecretKey, getPublicKey, matchFilters } from 'nostr-tools';
import type { Event as NostrEvent, Filter } from 'nostr-tools';

import { MarmotSession, quiesceMarmotSession, setMarmotSession } from './marmotSession';
import { createMemoryMarmotBackend } from './marmotStore';

const RELAY = 'wss://relay.test';

function makeRelay() {
  const events: NostrEvent[] = [];
  const asArray = (f: Filter | Filter[]) => (Array.isArray(f) ? f : [f]);
  const state = { accept: true, gate: Promise.resolve() };
  return {
    events,
    state,
    network: {
      async publish(relays: string[], event: NostrEvent) {
        if (event.kind === 30443) await state.gate;
        if (state.accept) events.push(event);
        return Object.fromEntries(relays.map((r) => [r, { from: r, ok: state.accept }]));
      },
      async request(_relays: string[], filters: Filter | Filter[]) {
        return asArray(filters).flatMap((f) => events.filter((e) => matchFilters([f], e)));
      },
      subscription() {
        return { subscribe: () => ({ unsubscribe: () => undefined }) };
      },
      async getUserInboxRelays() {
        return [RELAY];
      },
    },
  };
}

function makeSession(relay: ReturnType<typeof makeRelay>) {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const session = new MarmotSession({
    pubkey,
    signerType: 'nsec',
    signer: {
      getPublicKey: () => pubkey,
      signEvent: (draft: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(draft, sk),
    },
    network: relay.network as unknown as ConstructorParameters<typeof MarmotSession>[0]['network'],
    backend: createMemoryMarmotBackend(),
    getWriteRelays: () => [RELAY],
    getLookupRelays: () => [RELAY],
    keyPackageDrainMs: 200,
  });
  return { session, pubkey };
}

const keyPackages = (relay: ReturnType<typeof makeRelay>) =>
  relay.events.filter((e) => e.kind === 30443 && e.content);

describe('MarmotSession.refreshInvitationKey', () => {
  afterEach(() => setMarmotSession(null));

  test('publishes a new key even when the current one is fresh, in the same slot', async () => {
    const relay = makeRelay();
    const { session } = makeSession(relay);
    await session.ensureKeyPackage();
    expect(keyPackages(relay)).toHaveLength(1);
    await expect(session.refreshInvitationKey()).resolves.toBe(true);
    const [first, second] = keyPackages(relay);
    expect(second.created_at).toBeGreaterThan(first.created_at);
    const slot = (e: NostrEvent) => e.tags.find((t) => t[0] === 'd')?.[1];
    expect(slot(second)).toBe(slot(first));
    // A normal run afterwards doesn't publish again: the forced one was answered.
    await session.ensureKeyPackage();
    expect(keyPackages(relay)).toHaveLength(2);
  }, 30_000);

  test('reports failure when no relay accepts the new key', async () => {
    const relay = makeRelay();
    const { session } = makeSession(relay);
    relay.state.accept = false;
    await expect(session.refreshInvitationKey()).resolves.toBe(false);
  }, 30_000);

  test('queues behind a run in flight instead of publishing beside it', async () => {
    const relay = makeRelay();
    const { session } = makeSession(relay);
    let release!: () => void;
    relay.state.gate = new Promise<void>((resolve) => (release = resolve));
    const automatic = session.ensureKeyPackage();
    const refreshed = session.refreshInvitationKey();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(keyPackages(relay)).toHaveLength(0);
    release();
    await automatic;
    await expect(refreshed).resolves.toBe(true);
    expect(keyPackages(relay)).toHaveLength(2); // the automatic run, then the forced one
  }, 30_000);

  test('sign-out never waits on a pending Refresh, and a stopped session refuses one', async () => {
    const relay = makeRelay();
    const { session, pubkey } = makeSession(relay);
    setMarmotSession(session);
    relay.state.gate = new Promise<void>(() => undefined); // a publish that never finishes
    const refreshed = session.refreshInvitationKey();
    const started = Date.now();
    await quiesceMarmotSession(pubkey);
    expect(Date.now() - started).toBeLessThan(2_000);
    await expect(refreshed).rejects.toThrow('stopped');
    await expect(session.refreshInvitationKey()).resolves.toBe(false);
  }, 30_000);
});
