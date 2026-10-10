// End-to-end Marmot round trip with WebCrypto REMOVED, approximating Hermes
// (which has no crypto.subtle). If any marmot-ts / ts-mls code path still
// reaches SubtleCrypto, this suite fails — that's the whole point of it.
import {
  MarmotClient,
  createApplicationMessageIntent,
  createChatRumor,
  deserializeApplicationData,
} from '@internet-privacy/marmot-ts';
import { InMemoryKeyValueStore } from '@internet-privacy/marmot-ts/extra';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  matchFilters,
  nip44,
  nip59,
} from 'nostr-tools';
import type { Event as NostrEvent, Filter } from 'nostr-tools';

import { installMarmotCryptoProvider, marmotCryptoProvider } from './marmotCryptoProvider';
import {
  MARMOT_CHAT_KIND,
  MarmotNoKeyPackageError,
  MarmotSession,
  MarmotUnusableKeyPackageError,
  isUsableKeyPackage,
  buildMarmotRumor,
  quiesceMarmotSession,
  setMarmotSession,
  type MarmotMessageEvent,
  type MarmotRumor,
} from './marmotSession';
import { createMemoryMarmotBackend, decodeMarmotValue, encodeMarmotValue } from './marmotStore';
import { storedMarmotContent } from './marmotInbox';
import { MarmotWelcomeDeliveryError } from './marmotInvitees';
import { decryptMarmotMedia, marmotImetaTag } from './marmotMedia';
import { parseImageMessage, parseVoiceNote } from '../utils/messageContent';

const RELAY = 'wss://relay.test';

/** One in-memory relay shared by every client in the test. */
function makeRelay() {
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

function makeSigner() {
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

function makeClient(network: ReturnType<typeof makeRelay>['network']) {
  const { signer, pubkey } = makeSigner();
  const client = new MarmotClient({
    signer,
    network,
    cryptoProvider: marmotCryptoProvider,
    groupStateStore: new InMemoryKeyValueStore(),
    keyPackageStore: new InMemoryKeyValueStore(),
    clientId: 'lightning-piggy-test',
  });
  return { client, pubkey };
}

describe('Marmot without WebCrypto (Hermes smoke)', () => {
  const realSubtle = globalThis.crypto.subtle;

  beforeAll(() => {
    installMarmotCryptoProvider();
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
  });
  afterAll(() => {
    Object.defineProperty(globalThis.crypto, 'subtle', { value: realSubtle, configurable: true });
  });

  it('creates a group, invites, joins and exchanges messages both ways', async () => {
    expect(globalThis.crypto.subtle).toBeUndefined();
    const relay = makeRelay();
    const alice = makeClient(relay.network);
    const bob = makeClient(relay.network);

    await bob.client.keyPackages.create({ relays: [RELAY] });
    const [bobKeyPackage] = await relay.network.request(
      [RELAY],
      [{ kinds: [30443, 443], authors: [bob.pubkey] }],
    );
    expect(bobKeyPackage).toBeDefined();

    const group = await alice.client.groups.create('Piggy Bank', {
      description: 'test group',
      relays: [RELAY],
      adminPubkeys: [alice.pubkey],
    });
    await alice.client.groups.invite(group.id, bobKeyPackage);

    // Bob receives the gift-wrapped kind-444 Welcome.
    const wraps = await relay.network.request([RELAY], [{ kinds: [1059], '#p': [bob.pubkey] }]);
    expect(wraps.length).toBeGreaterThan(0);
    for (const w of wraps) await bob.client.invites.ingestEvent(w);
    await bob.client.invites.decryptGiftWraps();
    const [welcomeRumor] = await bob.client.invites.getUnread();
    expect(welcomeRumor?.kind).toBe(444);
    const { group: bobGroup } = await bob.client.joinGroupFromWelcome({ welcomeRumor });

    // Alice → Bob
    const bobInbox: string[] = [];
    bobGroup.on('applicationMessage', (data) =>
      bobInbox.push(deserializeApplicationData(data).content),
    );
    await alice.client.groups.send(
      group.id,
      createApplicationMessageIntent(
        createChatRumor({ pubkey: alice.pubkey, content: 'hello bob' }),
      ),
    );
    const groupEvents = () => relay.network.request([RELAY], [{ kinds: [445] }]);
    for await (const _ of bobGroup.ingest(await groupEvents())) void _;
    expect(bobInbox).toContain('hello bob');

    // Bob → Alice
    const aliceInbox: string[] = [];
    group.on('applicationMessage', (data) =>
      aliceInbox.push(deserializeApplicationData(data).content),
    );
    await bob.client.groups.send(
      bobGroup.id,
      createApplicationMessageIntent(createChatRumor({ pubkey: bob.pubkey, content: 'oink back' })),
    );
    for await (const _ of group.ingest(await groupEvents())) void _;
    expect(aliceInbox).toContain('oink back');
  }, 60_000);
});

// --- MarmotSession (the app's wrapper) -----------------------------------------

async function waitFor(cond: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

function makeSession(
  relay: ReturnType<typeof makeRelay>,
  pageSize?: number,
  signerType: 'nsec' | 'amber' = 'nsec',
) {
  const who = makeSigner();
  const inbox: MarmotMessageEvent[] = [];
  const session = new MarmotSession({
    pubkey: who.pubkey,
    signerType,
    signer: who.signer,
    network: relay.network,
    backend: createMemoryMarmotBackend(),
    getWriteRelays: () => [RELAY],
    getLookupRelays: () => [RELAY],
    groupBackfillPageSize: pageSize,
  });
  session.subscribe({ onMessage: (m) => inbox.push(m) });
  return { ...who, session, inbox };
}

/** Another install of an existing account: same key, its own device state. */
function makeInstall(relay: ReturnType<typeof makeRelay>, who: ReturnType<typeof makeSigner>) {
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
function unwrapWelcomes(
  relay: ReturnType<typeof makeRelay>,
  who: { pubkey: string; sk: Uint8Array },
) {
  return relay.events
    .filter((e) => e.kind === 1059 && e.tags.some((t) => t[0] === 'p' && t[1] === who.pubkey))
    .map((w) => nip59.unwrapEvent(w, who.sk) as unknown as MarmotRumor)
    .filter((r) => r.kind === 444);
}

describe('MarmotSession (no WebCrypto)', () => {
  const realSubtle = globalThis.crypto.subtle;
  beforeAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true }),
  );
  afterAll(() =>
    Object.defineProperty(globalThis.crypto, 'subtle', { value: realSubtle, configurable: true }),
  );

  it('drains key publication before account cleanup and cannot republish after stopping', async () => {
    const relay = makeRelay();
    const publish = relay.network.publish;
    let release!: () => void;
    let publishing = false;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    relay.network.publish = async (relays, event) => {
      if (event.kind === 30443) {
        publishing = true;
        await blocked;
      }
      return publish(relays, event);
    };
    const alice = makeSession(relay);
    setMarmotSession(alice.session);
    try {
      await alice.session.start();
      await waitFor(() => publishing);
      let drained = false;
      const cleanup = quiesceMarmotSession(alice.pubkey).then(() => (drained = true));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(drained).toBe(false);
      release();
      await cleanup;
      await alice.session.ensureKeyPackage();
      expect(relay.events.filter((e) => e.kind === 30443)).toHaveLength(1);
    } finally {
      release();
      setMarmotSession(null);
    }
  }, 60_000);

  /** A session whose kind-30443 signing waits for `gate` (an unanswered Amber / NIP-46 prompt). */
  function sessionWithSlowSigner(relay: ReturnType<typeof makeRelay>, gate: Promise<void>) {
    const who = makeSigner();
    const backend = createMemoryMarmotBackend();
    const session = new MarmotSession({
      pubkey: who.pubkey,
      signerType: 'nsec',
      signer: {
        ...who.signer,
        signEvent: async (draft: Parameters<typeof finalizeEvent>[0]) => {
          if (draft.kind === 30443) await gate;
          return finalizeEvent(draft, who.sk);
        },
      },
      network: relay.network,
      backend,
      getWriteRelays: () => [RELAY],
      getLookupRelays: () => [RELAY],
      keyPackageDrainMs: 200,
    });
    return { ...who, session, backend };
  }

  it('sign-out never hangs on a signer prompt nobody answers', async () => {
    const relay = makeRelay();
    const never = new Promise<void>(() => undefined);
    const alice = sessionWithSlowSigner(relay, never);
    setMarmotSession(alice.session);
    try {
      await alice.session.start();
      await waitFor(
        () =>
          (alice.session as unknown as { keyPackageRuns: { current: unknown } }).keyPackageRuns
            .current !== null,
      );
      const started = Date.now();
      await quiesceMarmotSession(alice.pubkey);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      setMarmotSession(null);
    }
  }, 30_000);

  it('a signer answer arriving after the wipe publishes and writes nothing', async () => {
    const relay = makeRelay();
    let answer!: () => void;
    const late = new Promise<void>((resolve) => (answer = resolve));
    const alice = sessionWithSlowSigner(relay, late);
    setMarmotSession(alice.session);
    try {
      await alice.session.start();
      await waitFor(
        () =>
          (alice.session as unknown as { keyPackageRuns: { current: unknown } }).keyPackageRuns
            .current !== null,
      );
      await quiesceMarmotSession(alice.pubkey);
      for (const ns of ['keyPackages', 'meta']) await alice.backend.clear(ns); // the wipe
      answer(); // the user approves the prompt after signing out
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(relay.events.filter((e) => e.kind === 30443)).toHaveLength(0);
      expect(await alice.backend.keys('keyPackages')).toEqual([]);
      expect(await alice.backend.keys('meta')).toEqual([]);
    } finally {
      setMarmotSession(null);
    }
  }, 30_000);

  it('bounds the wait for a stuck relay publish, and fences its late write', async () => {
    const relay = makeRelay();
    const publish = relay.network.publish;
    let release!: () => void;
    const stuck = new Promise<void>((resolve) => (release = resolve));
    relay.network.publish = async (relays, event) => {
      if (event.kind === 30443) await stuck;
      return publish(relays, event);
    };
    const alice = sessionWithSlowSigner(relay, Promise.resolve());
    setMarmotSession(alice.session);
    try {
      await alice.session.start();
      await waitFor(
        () =>
          (alice.session as unknown as { keyPackageRuns: { current: unknown } }).keyPackageRuns
            .current !== null,
      );
      const started = Date.now();
      await quiesceMarmotSession(alice.pubkey); // keyPackageDrainMs: 200
      expect(Date.now() - started).toBeLessThan(2_000);
      await alice.backend.clear('keyPackages'); // the wipe
      release();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await alice.backend.keys('keyPackages')).toEqual([]);
    } finally {
      release();
      setMarmotSession(null);
    }
  }, 30_000);

  it('keeps a Welcome for our own key retryable when the join fails, even as "No matching secret"', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    const bobKeys = makeSigner();
    const bobBackend = createMemoryMarmotBackend();
    const bob = new MarmotSession({
      pubkey: bobKeys.pubkey,
      signerType: 'nsec',
      signer: bobKeys.signer,
      network: relay.network,
      backend: bobBackend,
      getWriteRelays: () => [RELAY],
      getLookupRelays: () => [RELAY],
    });
    await Promise.all([alice.session.start(), bob.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bobKeys.pubkey));
    await alice.session.getOrCreateDm(bobKeys.pubkey);
    const [welcome] = unwrapWelcomes(relay, bobKeys);

    // marmot-ts reports only the LAST key's error — here from an unrelated key.
    const join = jest
      .spyOn(MarmotClient.prototype, 'joinGroupFromWelcome')
      .mockRejectedValueOnce(
        new Error(
          'Failed to join group with any matching key package. Last error: No matching secret found',
        ),
      );
    expect(await bob.acceptWelcome(welcome)).toBeNull();
    expect(await bobBackend.get('welcomes', welcome.id)).toBeNull();
    expect(await bobBackend.keys('pendingWelcomes')).toEqual([welcome.id]);
    join.mockRestore();
    expect(await bob.acceptWelcome(welcome)).not.toBeNull(); // the retry joins
    alice.session.stop();
    bob.stop();
  }, 60_000);

  it("drops a Welcome meant for another of the account's devices", async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    const bobKeys = makeSigner();
    const device = (backend = createMemoryMarmotBackend()) => ({
      backend,
      session: new MarmotSession({
        pubkey: bobKeys.pubkey,
        signerType: 'nsec',
        signer: bobKeys.signer,
        network: relay.network,
        backend,
        getWriteRelays: () => [RELAY],
        getLookupRelays: () => [RELAY],
      }),
    });
    const phone = device();
    await Promise.all([alice.session.start(), phone.session.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bobKeys.pubkey));
    await alice.session.getOrCreateDm(bobKeys.pubkey); // invites the phone's key package
    const [welcome] = unwrapWelcomes(relay, bobKeys);

    const tablet = device();
    await tablet.session.start();
    await waitFor(
      () => relay.events.filter((e) => e.kind === 30443 && e.pubkey === bobKeys.pubkey).length > 1,
    );
    expect(await tablet.session.acceptWelcome(welcome)).toBeNull();
    expect(await tablet.backend.get('welcomes', welcome.id)).not.toBeNull(); // handled for good
    expect(await tablet.backend.keys('pendingWelcomes')).toEqual([]);
    for (const s of [alice.session, phone.session, tablet.session]) s.stop();
  }, 60_000);

  it('round-trips the KV codec (bytes + bigint nested in objects)', () => {
    const value = {
      a: new Uint8Array([1, 2, 255]),
      n: 12345678901234567890n,
      nested: [{ b: new Uint8Array() }],
    };
    expect(decodeMarmotValue(encodeMarmotValue(value))).toEqual(value);
  });

  it('DM: White Noise conventions, invite → accept → messages both ways', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    const bob = makeSession(relay);
    await Promise.all([alice.session.start(), bob.session.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bob.pubkey));

    // Spec: the kind-30443 `d` slot is 32 random bytes (hex), stable per device.
    const bobKp = relay.events.find((e) => e.kind === 30443 && e.pubkey === bob.pubkey)!;
    expect(bobKp.tags.find((t) => t[0] === 'd')?.[1]).toMatch(/^[0-9a-f]{64}$/);

    const dm = await alice.session.getOrCreateDm(bob.pubkey);
    expect(dm).toMatchObject({ name: '', isDm: true, memberPubkeys: [bob.pubkey] });
    expect(dm.adminPubkeys.sort()).toEqual([alice.pubkey, bob.pubkey].sort());
    // Idempotent: a second open reuses the same group.
    expect((await alice.session.getOrCreateDm(bob.pubkey)).id).toBe(dm.id);

    const [welcome] = unwrapWelcomes(relay, bob);
    const joined = await bob.session.acceptWelcome(welcome);
    expect(joined).toMatchObject({ id: dm.id, isDm: true, memberPubkeys: [alice.pubkey] });
    expect(bob.session.findDm(alice.pubkey)?.id).toBe(dm.id);

    const hello = buildMarmotRumor(alice.pubkey, { kind: MARMOT_CHAT_KIND, content: 'hello bob' });
    await alice.session.sendRumor(dm.id, hello);
    await waitFor(() => bob.inbox.some((m) => m.rumor.id === hello.id));
    expect(bob.inbox.find((m) => m.rumor.id === hello.id)).toMatchObject({
      group: { id: dm.id, isDm: true },
      rumor: { pubkey: alice.pubkey, content: 'hello bob', kind: 9 },
    });

    // Any rumor kind rides along (here: a NIP-17-style kind-15 file message).
    const file = buildMarmotRumor(bob.pubkey, {
      kind: 15,
      content: 'https://blossom.example/abc',
      tags: [
        ['file-type', 'image/jpeg'],
        ['decryption-key', 'k'],
      ],
    });
    await bob.session.sendRumor(dm.id, file);
    await waitFor(() => alice.inbox.some((m) => m.rumor.id === file.id));
    expect(alice.inbox.find((m) => m.rumor.id === file.id)?.rumor.tags).toEqual(file.tags);

    // Group backfill queries are bounded (perf rule: limit on every filter).
    const groupQueries = relay.requests.flat().filter((f) => f.kinds?.includes(445));
    expect(groupQueries.length).toBeGreaterThan(0);
    expect(groupQueries.every((f) => typeof f.limit === 'number')).toBe(true);

    alice.session.stop();
    bob.session.stop();
  }, 60_000);

  it('group: create, rename, remove a member, leave', async () => {
    const relay = makeRelay();
    const [alice, bob, carol] = [makeSession(relay), makeSession(relay), makeSession(relay)];
    await Promise.all([alice, bob, carol].map((p) => p.session.start()));
    await waitFor(
      () =>
        relay.events.filter(
          (e) => e.kind === 30443 && [bob.pubkey, carol.pubkey].includes(e.pubkey),
        ).length === 2,
    );

    const group = await alice.session.createGroup('Piggy Bank', [bob.pubkey, carol.pubkey]);
    expect(group).toMatchObject({ name: 'Piggy Bank', isDm: false });
    expect(group.memberPubkeys.sort()).toEqual([bob.pubkey, carol.pubkey].sort());
    for (const who of [bob, carol]) {
      const [welcome] = unwrapWelcomes(relay, who);
      expect(await who.session.acceptWelcome(welcome)).not.toBeNull();
    }

    await alice.session.rename(group.id, 'Oink Club');
    expect(alice.session.getGroup(group.id)?.name).toBe('Oink Club');
    await waitFor(() => bob.session.getGroup(group.id)?.name === 'Oink Club');

    await alice.session.removeMember(group.id, carol.pubkey);
    expect(alice.session.getGroup(group.id)?.memberPubkeys).toEqual([bob.pubkey]);
    await waitFor(() => !bob.session.getGroup(group.id)?.memberPubkeys.includes(carol.pubkey));

    const msg = buildMarmotRumor(bob.pubkey, { kind: MARMOT_CHAT_KIND, content: 'just us now' });
    await bob.session.sendRumor(group.id, msg);
    await waitFor(() => alice.inbox.some((m) => m.rumor.id === msg.id));
    expect(carol.inbox.some((m) => m.rumor.id === msg.id)).toBe(false);

    await bob.session.leave(group.id);
    expect(bob.session.getGroup(group.id)).toBeUndefined();

    for (const p of [alice, bob, carol]) p.session.stop();
  }, 90_000);

  it('pages the kind-445 backfill so a long offline gap loses no commits', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    await alice.session.start();
    // Bob is "offline": he publishes a key package but only starts later,
    // with a page size far smaller than the backlog.
    const bobKeys = makeSigner();
    const bobBackend = createMemoryMarmotBackend();
    const bobOpts = {
      pubkey: bobKeys.pubkey,
      signerType: 'nsec' as const,
      signer: bobKeys.signer,
      network: relay.network,
      backend: bobBackend,
      getWriteRelays: () => [RELAY],
      getLookupRelays: () => [RELAY],
      groupBackfillPageSize: 3,
    };
    const bobFirst = new MarmotSession(bobOpts);
    await bobFirst.start();
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bobKeys.pubkey));
    const dm = await alice.session.getOrCreateDm(bobKeys.pubkey);
    const [welcome] = unwrapWelcomes(relay, bobKeys);
    await bobFirst.acceptWelcome(welcome);
    bobFirst.stop();

    // While Bob is away: 10 messages and an epoch-changing commit in between.
    for (let i = 0; i < 5; i++) {
      await alice.session.sendRumor(
        dm.id,
        buildMarmotRumor(alice.pubkey, { kind: 9, content: `m${i}` }),
      );
    }
    await alice.session.rename(dm.id, ''); // commit (epoch++) — must not be skipped
    const last = buildMarmotRumor(alice.pubkey, { kind: 9, content: 'latest' });
    await alice.session.sendRumor(dm.id, last);

    // Bob comes back with page size 3: the backlog (> 3 events) must be paged.
    const bob = new MarmotSession(bobOpts);
    const inbox: MarmotMessageEvent[] = [];
    bob.subscribe({ onMessage: (m) => inbox.push(m) });
    await bob.start();
    await waitFor(() => inbox.some((m) => m.rumor.id === last.id));
    const pages = relay.requests
      .flat()
      .filter((f) => f.kinds?.includes(445) && f.until !== undefined);
    expect(pages.length).toBeGreaterThan(0);
    alice.session.stop();
    bob.stop();
  }, 90_000);

  it('single-flights DM creation, joins each Welcome once, and defers remote-signer publishing', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    const bob = makeSession(relay);
    // An Amber-style account must not be prompted to sign at startup.
    const carol = makeSession(relay, undefined, 'amber');
    await Promise.all([alice, bob, carol].map((p) => p.session.start()));
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bob.pubkey));
    expect(relay.events.some((e) => e.kind === 30443 && e.pubkey === carol.pubkey)).toBe(false);

    // Two quick sends to a new peer → one DM group, one Welcome.
    const [a, b] = await Promise.all([
      alice.session.getOrCreateDm(bob.pubkey),
      alice.session.getOrCreateDm(bob.pubkey),
    ]);
    expect(a.id).toBe(b.id);
    const welcomes = unwrapWelcomes(relay, bob);
    expect(welcomes).toHaveLength(1);

    expect(await bob.session.acceptWelcome(welcomes[0])).not.toBeNull();
    // The same gift wrap re-surfacing (inbox refresh) is not re-joined.
    expect(await bob.session.acceptWelcome(welcomes[0])).toBeNull();
    expect(bob.session.findDm(alice.pubkey)?.id).toBe(a.id);

    // First Marmot use by the Amber account publishes its key package even
    // though the invite itself fails (dan has none) — so it becomes reachable.
    const dan = getPublicKey(generateSecretKey());
    await expect(carol.session.createGroup('x', [dan])).rejects.toBeInstanceOf(
      MarmotNoKeyPackageError,
    );
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === carol.pubkey));

    for (const p of [alice, bob, carol]) p.session.stop();
  }, 60_000);

  it('retries a Welcome left pending by a transient failure, and ignores future-dated 445s for the watermark', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    const bobKeys = makeSigner();
    const bobBackend = createMemoryMarmotBackend();
    const bobOpts = {
      pubkey: bobKeys.pubkey,
      signerType: 'nsec' as const,
      signer: bobKeys.signer,
      network: relay.network,
      backend: bobBackend,
      getWriteRelays: () => [RELAY],
      getLookupRelays: () => [RELAY],
    };
    const bobFirst = new MarmotSession(bobOpts);
    await Promise.all([alice.session.start(), bobFirst.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bobKeys.pubkey));
    const dm = await alice.session.getOrCreateDm(bobKeys.pubkey);
    const [welcome] = unwrapWelcomes(relay, bobKeys);
    bobFirst.stop();

    // Simulate a join that failed transiently last session: the invite is
    // still pending (its gift wrap won't be re-routed by the inbox).
    await bobBackend.set('pendingWelcomes', welcome.id, JSON.stringify(welcome));

    // An attacker publishes a validly-signed 445 with the group's public h
    // tag, dated a year ahead.
    const h = relay.events.find((e) => e.kind === 445)!.tags.find((t) => t[0] === 'h')![1];
    const attacker = generateSecretKey();
    relay.events.push(
      finalizeEvent(
        {
          kind: 445,
          created_at: Math.floor(Date.now() / 1000) + 365 * 86400,
          tags: [['h', h]],
          content: 'x',
        },
        attacker,
      ),
    );

    const bob = new MarmotSession(bobOpts);
    await bob.start();
    await waitFor(() => bob.findDm(alice.pubkey)?.id === dm.id);
    expect(await bobBackend.keys('pendingWelcomes')).toEqual([]);

    // A later reconnect must not ask relays only for events after the fake date.
    bob.stop();
    relay.requests.length = 0;
    const bobAgain = new MarmotSession(bobOpts);
    await bobAgain.start();
    await waitFor(() => relay.requests.flat().some((f) => f['#h']?.[0] === h));
    const since = relay.requests.flat().find((f) => f['#h']?.[0] === h)?.since ?? 0;
    expect(since).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));

    alice.session.stop();
    bobAgain.stop();
  }, 60_000);

  it('uses the newest DM with a peer after they lose state and start a fresh one', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    const bobKeys = makeSigner();
    const bobOpts = (backend: ReturnType<typeof createMemoryMarmotBackend>) => ({
      pubkey: bobKeys.pubkey,
      signerType: 'nsec' as const,
      signer: bobKeys.signer,
      network: relay.network,
      backend,
      getWriteRelays: () => [RELAY],
      getLookupRelays: () => [RELAY],
    });
    await alice.session.start();
    // Bob's first install starts a DM with Alice.
    const bobOld = new MarmotSession(bobOpts(createMemoryMarmotBackend()));
    await bobOld.start();
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === alice.pubkey));
    const oldDm = await bobOld.getOrCreateDm(alice.pubkey);
    await alice.session.acceptWelcome(unwrapWelcomes(relay, alice).at(-1)!);
    bobOld.stop();
    // Bob reinstalls (same keys, no MLS state) and starts a new DM.
    await new Promise((r) => setTimeout(r, 5)); // distinct firstSeen
    const bobNew = new MarmotSession(bobOpts(createMemoryMarmotBackend()));
    await bobNew.start();
    const newDm = await bobNew.getOrCreateDm(alice.pubkey);
    expect(newDm.id).not.toBe(oldDm.id);
    await alice.session.acceptWelcome(unwrapWelcomes(relay, alice).at(-1)!);
    expect(alice.session.findDm(bobKeys.pubkey)?.id).toBe(newDm.id);

    alice.session.stop();
    bobNew.stop();
  }, 60_000);

  it('re-delivers a message the app never stored (died after MLS processed it)', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    const bobKeys = makeSigner();
    const bobBackend = createMemoryMarmotBackend();
    const bobOpts = {
      pubkey: bobKeys.pubkey,
      signerType: 'nsec' as const,
      signer: bobKeys.signer,
      network: relay.network,
      backend: bobBackend,
      getWriteRelays: () => [RELAY],
      getLookupRelays: () => [RELAY],
    };
    // Bob's first run: joins and MLS-processes the message, but nothing is
    // listening — the app "died" before persisting it to its own stores.
    const bobFirst = new MarmotSession(bobOpts);
    await Promise.all([alice.session.start(), bobFirst.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bobKeys.pubkey));
    const dm = await alice.session.getOrCreateDm(bobKeys.pubkey);
    await bobFirst.acceptWelcome(unwrapWelcomes(relay, bobKeys).at(-1)!);
    const lost = buildMarmotRumor(alice.pubkey, {
      kind: MARMOT_CHAT_KIND,
      content: 'do not lose me',
    });
    await alice.session.sendRumor(dm.id, lost);
    await waitFor(() => relay.events.filter((e) => e.kind === 445).length >= 2);
    await new Promise((r) => setTimeout(r, 300)); // let bobFirst ingest it
    bobFirst.stop();

    // Next start: the message is replayed from the durable history.
    const bob = new MarmotSession(bobOpts);
    const inbox: MarmotMessageEvent[] = [];
    bob.subscribe({ onMessage: (m) => inbox.push(m) });
    await bob.start();
    expect(inbox.map((m) => m.rumor.id)).toContain(lost.id);
    expect(inbox.filter((m) => m.rumor.id === lost.id)).toHaveLength(1);

    alice.session.stop();
    bob.stop();
  }, 60_000);

  it('skips unusable key packages, explains when none are usable, and leaves no orphan group', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    const bob = makeSession(relay);
    await Promise.all([alice.session.start(), bob.session.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bob.pubkey));
    const good = relay.events.find((e) => e.kind === 30443 && e.pubkey === bob.pubkey)!;

    // The library's rules: valid now, expired later, malformed without its d tag.
    expect(isUsableKeyPackage(good)).toBe(true);
    expect(isUsableKeyPackage(good, Math.floor(Date.now() / 1000) + 365 * 86400)).toBe(false);
    expect(isUsableKeyPackage({ ...good, tags: good.tags.filter((t) => t[0] !== 'd') })).toBe(
      false,
    );

    // (a) Passes our pre-check (nostr-tools' cached "verified" marker survives
    // the spread) but the library rejects it at invite time: the error
    // propagates and the half-made group is destroyed — no orphan.
    const tampered = {
      ...good,
      id: 'f'.repeat(64),
      created_at: good.created_at + 10,
      tags: [...good.tags.filter((t) => t[0] !== 'd'), ['d', 'a'.repeat(64)]],
    };
    relay.events.splice(relay.events.indexOf(good), 1, tampered);
    await expect(alice.session.getOrCreateDm(bob.pubkey)).rejects.toThrow();
    expect(alice.session.listGroups()).toEqual([]);

    // (b) A plain (unverified) copy fails our pre-check: friendly error, no group.
    const broken = JSON.parse(JSON.stringify(tampered));
    relay.events.splice(relay.events.indexOf(tampered), 1, broken);
    await expect(alice.session.getOrCreateDm(bob.pubkey)).rejects.toBeInstanceOf(
      MarmotUnusableKeyPackageError,
    );
    expect(alice.session.listGroups()).toEqual([]);
    expect(await alice.session.canMessage(bob.pubkey)).toBe(false);

    // A good one alongside the broken one is used.
    relay.events.push(good);
    const dm = await alice.session.getOrCreateDm(bob.pubkey);
    expect(dm.isDm).toBe(true);

    alice.session.stop();
    bob.session.stop();
  }, 60_000);

  it('photos: White Noise-compatible v2 media that decrypts from the stored row alone', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    const bob = makeSession(relay);
    await Promise.all([alice.session.start(), bob.session.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bob.pubkey));
    // White Noise only invites people whose key package supports media v2.
    const bobKp = relay.events.find((e) => e.kind === 30443 && e.pubkey === bob.pubkey)!;
    expect(bobKp.tags.find((t) => t[0] === 'app_components')).toContain('0x800b');

    const dm = await alice.session.getOrCreateDm(bob.pubkey);
    await bob.session.acceptWelcome(unwrapWelcomes(relay, bob)[0]);

    const photo = new Uint8Array(4096).map((_, i) => (i * 31) % 256);
    const enc = await alice.session.encryptMedia(dm.id, photo, 'image/png', 'photo.png');
    expect(enc.attachment.version).toBe('encrypted-media-v2');
    const url = `https://blossom.example/${enc.attachment.ciphertextSha256}.bin`;
    const rumor = buildMarmotRumor(alice.pubkey, {
      kind: MARMOT_CHAT_KIND,
      content: '',
      tags: [marmotImetaTag(enc.attachment, url)],
    });
    await alice.session.sendRumor(dm.id, rumor);
    await waitFor(() => bob.inbox.some((m) => m.rumor.id === rumor.id));

    // Bob's row: an image (kind 15, `#lpe=1` URL) that decrypts with no group state.
    const received = bob.inbox.find((m) => m.rumor.id === rumor.id)!;
    expect(received.mediaKeys?.[enc.attachment.ciphertextSha256]).toMatchObject({ url });
    expect(received.mediaKeys?.[enc.attachment.ciphertextSha256]?.keysHex).toContain(enc.keyHex);
    const stored = storedMarmotContent(received.rumor, received.mediaKeys);
    expect(stored.kind).toBe(15);
    const image = parseImageMessage(stored.text)!;
    expect(image).toMatchObject({ url, mime: 'image/png', encrypted: true });
    expect(decryptMarmotMedia(enc.encrypted, { ...image, marmot: image.marmot! })).toEqual(photo);

    // Without keys (none derived) it's a labelled fallback — never an empty bubble.
    expect(storedMarmotContent(received.rumor, undefined)).toEqual({
      text: "Couldn't open attachment: photo.png",
      kind: 14,
    });

    alice.session.stop();
    bob.session.stop();
  }, 60_000);

  it('voice notes: audio/mp4 media (White Noise shape) decrypts into the voice-note bubble', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    const bob = makeSession(relay);
    await Promise.all([alice.session.start(), bob.session.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bob.pubkey));
    const dm = await alice.session.getOrCreateDm(bob.pubkey);
    await bob.session.acceptWelcome(unwrapWelcomes(relay, bob)[0]);

    const clip = new Uint8Array(2048).map((_, i) => (i * 7) % 256);
    const enc = await alice.session.encryptMedia(dm.id, clip, 'audio/mp4', 'voice-2000ms.m4a');
    const url = `https://blossom.example/${enc.attachment.ciphertextSha256}.bin`;
    const rumor = buildMarmotRumor(alice.pubkey, {
      kind: MARMOT_CHAT_KIND,
      content: '',
      tags: [marmotImetaTag(enc.attachment, url)],
    });
    await alice.session.sendRumor(dm.id, rumor);
    await waitFor(() => bob.inbox.some((m) => m.rumor.id === rumor.id));

    const received = bob.inbox.find((m) => m.rumor.id === rumor.id)!;
    const stored = storedMarmotContent(received.rumor, received.mediaKeys);
    expect(stored.kind).toBe(15);
    expect(parseImageMessage(stored.text)).toBeNull();
    const voice = parseVoiceNote(stored.text)!;
    expect(voice).toMatchObject({ url, mime: 'audio/mp4', encrypted: true });
    expect(decryptMarmotMedia(enc.encrypted, { ...voice, marmot: voice.marmot! })).toEqual(clip);

    alice.session.stop();
    bob.session.stop();
  }, 60_000);

  it('reactions: White Noise-format kind 7 / kind 5 inside the group, read back from history', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    const bob = makeSession(relay);
    await Promise.all([alice.session.start(), bob.session.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === bob.pubkey));
    const dm = await alice.session.getOrCreateDm(bob.pubkey);
    await bob.session.acceptWelcome(unwrapWelcomes(relay, bob)[0]);

    const hello = buildMarmotRumor(alice.pubkey, { kind: MARMOT_CHAT_KIND, content: 'oink' });
    await alice.session.sendRumor(dm.id, hello);
    await waitFor(() => bob.inbox.some((m) => m.rumor.id === hello.id));

    // MDK's shape: content = the emoji, one `e` tag → the message.
    const reaction = buildMarmotRumor(bob.pubkey, {
      kind: 7,
      content: '🐷',
      tags: [['e', hello.id]],
    });
    await bob.session.sendRumor(dm.id, reaction);
    await waitFor(() => alice.inbox.some((m) => m.rumor.id === reaction.id));
    // Both sides read it back from history (the sender's own copy included).
    for (const who of [alice, bob]) {
      const found = (await who.session.queryHistory(dm.id, [7])).filter((r) =>
        r.tags.some((t) => t[0] === 'e' && t[1] === hello.id),
      );
      expect(found.map((r) => r.content)).toEqual(['🐷']);
    }
    const retract = buildMarmotRumor(bob.pubkey, {
      kind: 5,
      content: '',
      tags: [['e', reaction.id]],
    });
    await bob.session.sendRumor(dm.id, retract);
    await waitFor(() => alice.inbox.some((m) => m.rumor.id === retract.id));
    const deletions = (await alice.session.queryHistory(dm.id, [5])).filter((r) =>
      r.tags.some((t) => t[0] === 'e' && t[1] === reaction.id),
    );
    expect(deletions.map((d) => d.pubkey)).toEqual([bob.pubkey]);

    alice.session.stop();
    bob.session.stop();
  }, 60_000);

  it('multi-device: invites every device of a contact; one conversation, attributed per account', async () => {
    const relay = makeRelay();
    // Fault injection (installed before the sessions capture `publish`):
    // reject the next N Welcome gift wraps.
    const publish = relay.network.publish;
    let rejectWraps = 0;
    relay.network.publish = async (relays, event) => {
      if (event.kind === 1059 && rejectWraps > 0) {
        rejectWraps--;
        return Object.fromEntries(relays.map((r) => [r, { from: r, ok: false, message: 'no' }]));
      }
      return publish(relays, event);
    };
    const big = makeSession(relay);
    const bigOtherPhone = makeInstall(relay, big);
    const littleId = makeSigner();
    const [phone, tablet] = [makeInstall(relay, littleId), makeInstall(relay, littleId)];
    await Promise.all([big, bigOtherPhone, phone, tablet].map((p) => p.session.start()));
    const kps = (pk: string) => relay.events.filter((e) => e.kind === 30443 && e.pubkey === pk);
    await waitFor(() => kps(littleId.pubkey).length === 2 && kps(big.pubkey).length === 2);
    // A third Little key package that can't be used (bad signature, new slot):
    // skipped, the two good devices still join.
    const broken = JSON.parse(JSON.stringify(kps(littleId.pubkey)[0])) as NostrEvent;
    broken.tags = [...broken.tags.filter((t) => t[0] !== 'd'), ['d', 'b'.repeat(64)]];
    broken.created_at += 5;
    relay.events.push(broken);

    // One of the two Welcomes fails to publish: logged, not fatal — the
    // commit still adds both devices.
    rejectWraps = 1;
    const dm = await big.session.getOrCreateDm(littleId.pubkey);
    // Three leaves (Big + two Little devices), still ONE DM with ONE member.
    expect(dm).toMatchObject({ isDm: true, memberPubkeys: [littleId.pubkey] });
    // Our own other phone is never invited (that would be device linking).
    expect(unwrapWelcomes(relay, big)).toHaveLength(0);
    // One Welcome per device, each naming that device's key package.
    const welcomes = unwrapWelcomes(relay, littleId);
    expect(welcomes).toHaveLength(1);
    // The surviving Welcome carries both devices' secrets: either can join.
    for (const device of [phone, tablet]) {
      const joined = await device.session.acceptWelcome(welcomes[0]);
      expect(joined).toMatchObject({ id: dm.id, isDm: true, memberPubkeys: [big.pubkey] });
    }

    // Both devices reply; Big sees one conversation, both attributed to Little.
    const fromPhone = buildMarmotRumor(littleId.pubkey, {
      kind: MARMOT_CHAT_KIND,
      content: 'phone',
    });
    const fromTablet = buildMarmotRumor(littleId.pubkey, {
      kind: MARMOT_CHAT_KIND,
      content: 'tablet',
    });
    await phone.session.sendRumor(dm.id, fromPhone);
    await waitFor(() => tablet.inbox.some((m) => m.rumor.id === fromPhone.id));
    await tablet.session.sendRumor(dm.id, fromTablet);
    await waitFor(() => big.inbox.filter((m) => m.group.id === dm.id).length >= 2);
    const received = big.inbox.filter((m) => m.group.id === dm.id);
    expect(received.map((m) => [m.rumor.content, m.rumor.pubkey])).toEqual([
      ['phone', littleId.pubkey],
      ['tablet', littleId.pubkey],
    ]);
    expect(big.session.listGroups()).toHaveLength(1);
    expect(await big.session.dmGroupIdsWith(littleId.pubkey)).toEqual([dm.id]);

    // Big's message reaches both of Little's devices.
    const hello = buildMarmotRumor(big.pubkey, { kind: MARMOT_CHAT_KIND, content: 'hi both' });
    await big.session.sendRumor(dm.id, hello);
    await waitFor(() => [phone, tablet].every((d) => d.inbox.some((m) => m.rumor.id === hello.id)));
    [big, bigOtherPhone, phone, tablet].forEach((p) => p.session.stop());
  }, 90_000);

  it('multi-device: a second Welcome for a group we already joined is handled, not retried', async () => {
    const relay = makeRelay();
    const big = makeSession(relay);
    const little = makeSession(relay);
    await Promise.all([big.session.start(), little.session.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === little.pubkey));
    const dm = await big.session.getOrCreateDm(little.pubkey);
    const [welcome] = unwrapWelcomes(relay, little);
    expect(await little.session.acceptWelcome(welcome)).toMatchObject({ id: dm.id });
    // The same Welcome under another rumor id (one gift wrap per invited
    // device of our account): no duplicate group, nothing left pending.
    const twin = buildMarmotRumor(welcome.pubkey, {
      kind: welcome.kind,
      content: welcome.content,
      tags: [...welcome.tags, ['client', 'second device']],
      created_at: welcome.created_at,
    });
    expect(await little.session.acceptWelcome(twin)).toBeNull();
    expect(little.session.listGroups()).toHaveLength(1);
    big.session.stop();
    little.session.stop();
  }, 60_000);

  it('multi-device: no group is left behind when every Welcome fails', async () => {
    const relay = makeRelay();
    const publish = relay.network.publish;
    relay.network.publish = async (relays, event) =>
      event.kind === 1059
        ? Object.fromEntries(relays.map((r) => [r, { from: r, ok: false, message: 'no' }]))
        : publish(relays, event);
    const big = makeSession(relay);
    const little = makeSession(relay);
    await Promise.all([big.session.start(), little.session.start()]);
    await waitFor(() => relay.events.some((e) => e.kind === 30443 && e.pubkey === little.pubkey));
    await expect(big.session.getOrCreateDm(little.pubkey)).rejects.toBeInstanceOf(
      MarmotWelcomeDeliveryError,
    );
    expect(big.session.listGroups()).toEqual([]);
    big.session.stop();
    little.session.stop();
  }, 60_000);

  it('refuses to start a chat with someone who has no key package', async () => {
    const relay = makeRelay();
    const alice = makeSession(relay);
    await alice.session.start();
    const stranger = getPublicKey(generateSecretKey());
    expect(await alice.session.canMessage(stranger)).toBe(false);
    await expect(alice.session.getOrCreateDm(stranger)).rejects.toBeInstanceOf(
      MarmotNoKeyPackageError,
    );
    alice.session.stop();
  });
});
