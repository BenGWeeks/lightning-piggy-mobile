import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  applyContactChange,
  fetchLatestContactList,
  prepareContactListUpdate,
  resolveContactListBase,
  type ConnectContactListRelay,
  type ContactListBase,
  type ContactListFetchResult,
  type ContactListRelay,
} from './contactListSync';
import type { NostrContact } from '../types/nostr';

const BIG = 'b'.repeat(64);
const LITTLE = 'c'.repeat(64);
const NEW = 'd'.repeat(64);
const RELAY_CONTENT = '{"wss://relay.example":{"read":true,"write":true}}';

const relayBase: ContactListBase = {
  tags: [
    ['client', 'Some Other App'],
    ['p', BIG, 'wss://r.example', 'Big'],
    ['t', 'bitcoin'],
    ['p', LITTLE, '', ''],
  ],
  content: RELAY_CONTENT,
  createdAt: 1_700_000_000,
};
const found = (base: ContactListBase = relayBase): ContactListFetchResult => ({
  status: 'found',
  base,
});
const contact = (pubkey: string): NostrContact => ({
  pubkey,
  relay: null,
  petname: null,
  profile: null,
});
const pTags = (tags: string[][]) => tags.filter((t) => t[0] === 'p').map((t) => t[1]);

describe('prepareContactListUpdate (#1271)', () => {
  it('builds on the relay list when the local list never loaded', async () => {
    const update = await prepareContactListUpdate({
      pubkey: 'a'.repeat(64),
      relays: ['wss://r'],
      localContacts: [],
      change: { type: 'follow', pubkey: NEW },
      fetchLatest: async () => found(),
    });
    expect(update).not.toBeNull();
    expect(pTags(update!.event.tags)).toEqual([BIG, LITTLE, NEW]);
    expect(update!.contacts.map((c) => c.pubkey)).toEqual([BIG, LITTLE, NEW]);
    expect(update!.changed).toBe(true);
  });

  it('refuses to publish when the fetch fails and the local list is empty', async () => {
    const update = await prepareContactListUpdate({
      pubkey: 'a'.repeat(64),
      relays: ['wss://r'],
      localContacts: [],
      change: { type: 'follow', pubkey: NEW },
      fetchLatest: async () => ({ status: 'failed' }),
    });
    expect(update).toBeNull();
  });

  it('refuses when the fetch fails even if the local list has entries (it may be stale)', async () => {
    const update = await prepareContactListUpdate({
      pubkey: 'a'.repeat(64),
      relays: ['wss://r'],
      localContacts: [contact(BIG)],
      change: { type: 'follow', pubkey: NEW },
      fetchLatest: async () => ({ status: 'failed' }),
    });
    expect(update).toBeNull();
  });

  it('LP-created account: 2+ relays confirm no list → the first follow publishes [new]', async () => {
    const update = await prepareContactListUpdate({
      pubkey: 'a'.repeat(64),
      relays: ['wss://r1', 'wss://r2'],
      localContacts: [],
      change: { type: 'follow', pubkey: NEW },
      allowEmptyList: true,
      fetchLatest: async () => ({ status: 'empty', confirmedBy: 2 }),
    });
    expect(pTags(update!.event.tags)).toEqual([NEW]);
    expect(update!.event.content).toBe('');
    expect(update!.listSeen).toBe(false);
  });

  it('imported / signed-in account: 2+ relays answering empty still refuses', async () => {
    const update = await prepareContactListUpdate({
      pubkey: 'a'.repeat(64),
      relays: ['wss://r1', 'wss://r2', 'wss://r3'],
      localContacts: [],
      change: { type: 'follow', pubkey: NEW },
      fetchLatest: async () => ({ status: 'empty', confirmedBy: 3 }),
    });
    expect(update).toBeNull();
  });

  it('reports listSeen when the relays returned a list', async () => {
    const update = await prepareContactListUpdate({
      pubkey: 'a'.repeat(64),
      relays: ['wss://r'],
      localContacts: [],
      change: { type: 'follow', pubkey: NEW },
      allowEmptyList: true,
      fetchLatest: async () => found(),
    });
    expect(update?.listSeen).toBe(true);
  });

  it('reports no change when the relay list already follows them (no signer prompt)', async () => {
    const update = await prepareContactListUpdate({
      pubkey: 'a'.repeat(64),
      relays: ['wss://r'],
      localContacts: [],
      change: { type: 'follow', pubkey: LITTLE },
      fetchLatest: async () => found(),
    });
    expect(update?.changed).toBe(false);
    expect(update?.contacts.map((c) => c.pubkey)).toEqual([BIG, LITTLE]);
  });

  it('keeps already-loaded profiles on the rebuilt local list', async () => {
    const bigWithProfile = { ...contact(BIG), profile: { name: 'Big' } as NostrContact['profile'] };
    const update = await prepareContactListUpdate({
      pubkey: 'a'.repeat(64),
      relays: ['wss://r'],
      localContacts: [bigWithProfile],
      change: { type: 'follow', pubkey: NEW },
      fetchLatest: async () => found(),
    });
    expect(update?.contacts[0].profile).toEqual({ name: 'Big' });
  });
});

describe('resolveContactListBase', () => {
  it('refuses a confirmed-empty answer for an account not created here', () => {
    expect(resolveContactListBase({ status: 'empty', confirmedBy: 2 })).toBeNull();
  });

  it('starts an empty list for an account created here', () => {
    expect(
      resolveContactListBase({ status: 'empty', confirmedBy: 2 }, null, { allowEmpty: true }),
    ).toEqual({ tags: [], content: '', createdAt: 0 });
  });

  it('refuses when the fetch fails, even with a list published earlier this session', () => {
    expect(
      resolveContactListBase({ status: 'failed' }, relayBase, { allowEmpty: true }),
    ).toBeNull();
  });

  it('uses the relay list', () => {
    expect(resolveContactListBase(found())).toBe(relayBase);
  });

  it('prefers the list this session just published when relays still serve an older one', () => {
    const published = { ...relayBase, createdAt: relayBase.createdAt + 5 };
    expect(resolveContactListBase(found(), published)).toBe(published);
    const older = { ...relayBase, createdAt: relayBase.createdAt - 5 };
    expect(resolveContactListBase(found(), older)).toBe(relayBase);
  });
});

describe('applyContactChange', () => {
  it('keeps content, other tags and order; swaps in our client tag; bumps created_at', () => {
    const event = applyContactChange(relayBase, { type: 'follow', pubkey: NEW }, 1_600_000_000);
    expect(event.content).toBe(RELAY_CONTENT);
    expect(event.tags).toEqual([
      ['client', 'Lightning Piggy'],
      ['p', BIG, 'wss://r.example', 'Big'],
      ['t', 'bitcoin'],
      ['p', LITTLE, '', ''],
      ['p', NEW, '', ''],
    ]);
    // Clock behind the base event: still strictly newer so relays accept it.
    expect(event.created_at).toBe(relayBase.createdAt + 1);
  });

  it('unfollows case-insensitively and leaves everyone else', () => {
    const event = applyContactChange(relayBase, { type: 'unfollow', pubkey: BIG.toUpperCase() });
    expect(pTags(event.tags)).toEqual([LITTLE]);
    expect(event.tags).toContainEqual(['t', 'bitcoin']);
  });
});

describe('fetchLatestContactList', () => {
  const sk = generateSecretKey();
  const me = getPublicKey(sk);
  // JSON round-trip = what arrives off the wire (no cached "verified" symbol).
  const wire = <T>(e: T): T => JSON.parse(JSON.stringify(e));
  const kind3 = (createdAt: number, p: string[], signer = sk) =>
    wire(
      finalizeEvent(
        { kind: 3, created_at: createdAt, tags: p.map((x) => ['p', x]), content: '' },
        signer,
      ),
    );

  type Params = Parameters<ContactListRelay['subscribe']>[1];
  type Script = (h: Params) => void;
  /** Fake relays: 'down' rejects the connection; a function scripts the subscription. */
  const relaysOf =
    (scripts: Record<string, Script | 'down'>): ConnectContactListRelay =>
    async (url) => {
      const script = scripts[url];
      if (!script || script === 'down') throw new Error('connection failed');
      return {
        subscribe: (_filters, h) => {
          setTimeout(() => script(h), 0);
          return { close: jest.fn() };
        },
      };
    };
  const eose: Script = (h) => h.oneose();
  const silent: Script = () => {};
  const fetch = (urls: Record<string, Script | 'down'>, timeoutMs = 1000) =>
    fetchLatestContactList(me, Object.keys(urls), { timeoutMs, connect: relaysOf(urls) });

  it('returns the newest verified kind-3 and ignores forged or foreign events', async () => {
    const older = kind3(100, [BIG]);
    const newest = kind3(200, [BIG, LITTLE]);
    const foreign = kind3(400, [NEW], generateSecretKey());
    const res = await fetch({
      'wss://a': (h) => {
        h.onevent(older);
        h.onevent(foreign);
        h.oneose();
      },
      'wss://b': (h) => {
        h.onevent(newest);
        h.oneose();
      },
    });
    expect(res.status === 'found' && pTags(res.base.tags)).toEqual([BIG, LITTLE]);
  });

  it('does not stop at the first copy: a newer one from a slower relay still wins', async () => {
    const res = await fetch({
      'wss://fast': (h) => {
        h.onevent(kind3(100, [BIG]));
        h.oneose();
      },
      'wss://slow': (h) =>
        setTimeout(() => {
          h.onevent(kind3(200, [BIG, LITTLE]));
          h.oneose();
        }, 50),
    });
    expect(res.status === 'found' && pTags(res.base.tags)).toEqual([BIG, LITTLE]);
  });

  it('breaks created_at ties by the lowest event id, whatever the arrival order', async () => {
    const a = kind3(300, [BIG]);
    const b = kind3(300, [LITTLE]);
    const [low, high] = a.id < b.id ? [a, b] : [b, a];
    for (const order of [
      [low, high],
      [high, low],
    ]) {
      const res = await fetch({
        'wss://a': (h) => {
          order.forEach((e) => h.onevent(e));
          h.oneose();
        },
      });
      expect(res.status === 'found' && pTags(res.base.tags)).toEqual(pTags(low.tags));
    }
  });

  it("is 'empty' only when 2+ relays connected and sent EOSE with no kind-3", async () => {
    await expect(fetch({ 'wss://a': eose, 'wss://b': eose, 'wss://c': 'down' })).resolves.toEqual({
      status: 'empty',
      confirmedBy: 2,
    });
  });

  it("is 'failed' when only one relay confirms (the rest down or silent)", async () => {
    await expect(fetch({ 'wss://a': eose, 'wss://b': 'down' })).resolves.toEqual({
      status: 'failed',
    });
    await expect(fetch({ 'wss://a': eose, 'wss://b': silent }, 50)).resolves.toEqual({
      status: 'failed',
    });
  });

  it("is 'failed' when no relay connects", async () => {
    await expect(fetch({ 'wss://a': 'down', 'wss://b': 'down' })).resolves.toEqual({
      status: 'failed',
    });
  });

  it("is 'failed', never 'empty', when the author's list arrives but can't be verified", async () => {
    const forged = { ...kind3(300, [NEW]), sig: 'f'.repeat(128) };
    const invalid: Script = (h) => {
      h.oninvalidevent(kind3(200, [BIG])); // dropped by the relay's own check
      h.oneose();
    };
    await expect(fetch({ 'wss://a': invalid, 'wss://b': eose, 'wss://c': eose })).resolves.toEqual({
      status: 'failed',
    });
    const bad: Script = (h) => {
      h.onevent(forged);
      h.oneose();
    };
    await expect(fetch({ 'wss://a': bad, 'wss://b': eose, 'wss://c': eose })).resolves.toEqual({
      status: 'failed',
    });
  });

  it('a relay closing the subscription does not count as a confirmation', async () => {
    const closed: Script = (h) => h.onclose('restricted: no');
    await expect(fetch({ 'wss://a': eose, 'wss://b': closed })).resolves.toEqual({
      status: 'failed',
    });
  });

  it('returns the found copy when the overall timeout hits before EOSE', async () => {
    const res = await fetch({ 'wss://a': (h) => h.onevent(kind3(200, [BIG])) }, 40);
    expect(res.status).toBe('found');
  });
});
