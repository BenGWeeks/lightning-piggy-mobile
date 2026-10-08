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
import { finalizeEvent, generateSecretKey, getPublicKey, matchFilters, nip44 } from 'nostr-tools';
import type { Event as NostrEvent, Filter } from 'nostr-tools';

import { installMarmotCryptoProvider, marmotCryptoProvider } from './marmotCryptoProvider';

const RELAY = 'wss://relay.test';

/** One in-memory relay shared by every client in the test. */
function makeRelay() {
  const events: NostrEvent[] = [];
  const subs = new Set<{ filters: Filter[]; next: (e: NostrEvent) => void }>();
  const asArray = (f: Filter | Filter[]) => (Array.isArray(f) ? f : [f]);
  return {
    events,
    network: {
      async publish(relays: string[], event: NostrEvent) {
        events.push(event);
        for (const s of subs) if (matchFilters(s.filters, event)) s.next(event);
        return Object.fromEntries(relays.map((r) => [r, { from: r, ok: true }]));
      },
      async request(_relays: string[], filters: Filter | Filter[]) {
        return events.filter((e) => matchFilters(asArray(filters), e));
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
