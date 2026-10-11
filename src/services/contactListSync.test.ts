import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { pool } from './nostrPool';
import {
  applyContactChange,
  fetchLatestContactList,
  prepareContactListUpdate,
  resolveContactListBase,
  type ContactListBase,
  type ContactListFetchResult,
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
  it('refuses when relays report no kind-3 and the local list is empty (EOSE is not proof)', () => {
    expect(resolveContactListBase({ status: 'none' }, [])).toBeNull();
  });

  it('builds on a non-empty local list when relays report no kind-3', () => {
    expect(resolveContactListBase({ status: 'none' }, [contact(BIG)])?.tags).toEqual([
      ['p', BIG, '', ''],
    ]);
  });

  it('falls back to a non-empty local list when relays fail', () => {
    expect(resolveContactListBase({ status: 'failed' }, [contact(BIG)])?.tags).toEqual([
      ['p', BIG, '', ''],
    ]);
  });

  it('prefers the relay list over a stale local list', () => {
    expect(resolveContactListBase(found(), [contact(NEW)])).toBe(relayBase);
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

  type Handlers = {
    onevent: (e: unknown) => void;
    oneose: () => void;
    onclose: (reasons: string[]) => void;
  };
  const mockRelays = (drive: (h: Handlers) => void) =>
    jest.spyOn(pool, 'subscribeMany').mockImplementation(((
      _relays: string[],
      _filter: unknown,
      h: Handlers,
    ) => {
      setTimeout(() => drive(h), 0);
      return { close: jest.fn() };
    }) as unknown as typeof pool.subscribeMany);

  afterEach(() => jest.restoreAllMocks());

  it('returns the newest verified kind-3 and ignores forged or foreign events', async () => {
    const older = kind3(100, [BIG]);
    const newest = kind3(200, [BIG, LITTLE]);
    const forged = { ...kind3(300, [NEW]), sig: 'f'.repeat(128) };
    const foreign = kind3(400, [NEW], generateSecretKey());
    mockRelays((h) => {
      [older, newest, forged, foreign].forEach((e) => h.onevent(e));
      h.oneose();
    });
    const res = await fetchLatestContactList(me, ['wss://a', 'wss://b'], 1000);
    expect(res.status).toBe('found');
    expect(res.status === 'found' && pTags(res.base.tags)).toEqual([BIG, LITTLE]);
  });

  it('uses the first verified kind-3 after a short grace when a relay never answers', async () => {
    const list = kind3(200, [BIG, LITTLE]);
    mockRelays((h) => h.onevent(list)); // no EOSE: one relay hangs
    const started = Date.now();
    const res = await fetchLatestContactList(me, ['wss://a', 'wss://hung'], 5000, 30);
    expect(res.status).toBe('found');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("reports 'none' when relays answer with no kind-3", async () => {
    mockRelays((h) => h.oneose());
    await expect(fetchLatestContactList(me, ['wss://a'], 1000)).resolves.toEqual({
      status: 'none',
    });
  });

  it("reports 'failed' when every relay fails to connect", async () => {
    mockRelays((h) => {
      h.oneose();
      h.onclose(['connection failed', 'relay connection timed out']);
    });
    await expect(fetchLatestContactList(me, ['wss://a', 'wss://b'], 1000)).resolves.toEqual({
      status: 'failed',
    });
  });

  it("reports 'failed' on timeout with nothing received", async () => {
    mockRelays(() => {});
    await expect(fetchLatestContactList(me, ['wss://a'], 20)).resolves.toEqual({
      status: 'failed',
    });
  });
});
