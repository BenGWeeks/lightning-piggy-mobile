import { MarmotClient, getKeyPackageLifetime } from '@internet-privacy/marmot-ts';
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
  KEY_PACKAGE_REFRESH_SECS,
  KeyPackageMaintenanceCancelled,
  SingleFlight,
  UNUSED_REPLACED_KEY_RETENTION_SECS,
  currentKeyPackage,
  maintainKeyPackage,
  monotonicKeyPackageSigner,
  needsRefresh,
  shouldDeleteReplacedKeyPackage,
} from './marmotKeyPackageLifecycle';
import { newestEvent } from './marmotKeyPackages';

const RELAY = 'wss://relay.test';
const SLOT = 'ab'.repeat(32);
const DAY = 24 * 60 * 60;
const realNow = Date.now.bind(Date);
/** Move the clock (seconds ahead of real time) for everything, incl. minting. */
const advance = (secs: number) => jest.spyOn(Date, 'now').mockReturnValue(realNow() + secs * 1000);

function makeRelay() {
  const events: NostrEvent[] = [];
  const asArray = (f: Filter | Filter[]) => (Array.isArray(f) ? f : [f]);
  return {
    events,
    network: {
      async publish(relays: string[], event: NostrEvent) {
        events.push(event);
        return Object.fromEntries(relays.map((r) => [r, { from: r, ok: true }]));
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

function makeClient(network: ReturnType<typeof makeRelay>['network']) {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const signer = {
    getPublicKey: () => pubkey,
    signEvent: (draft: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(draft, sk),
    nip44: {
      encrypt: (pk: string, pt: string) => nip44.encrypt(pt, nip44.getConversationKey(sk, pk)),
      decrypt: (pk: string, ct: string) => nip44.decrypt(ct, nip44.getConversationKey(sk, pk)),
    },
  };
  const client = new MarmotClient({
    signer,
    network,
    cryptoProvider: marmotCryptoProvider,
    groupStateStore: new InMemoryKeyValueStore(),
    keyPackageStore: new InMemoryKeyValueStore(),
  });
  return { client, pubkey, sk };
}

const maintain = (
  client: MarmotClient,
  extra: Partial<Parameters<typeof maintainKeyPackage>[1]> = {},
) =>
  maintainKeyPackage(client.keyPackages, {
    relays: [RELAY],
    slot: SLOT,
    client: 'Lightning Piggy',
    isUpToDate: () => true,
    ...extra,
  });

type Listed = Parameters<typeof shouldDeleteReplacedKeyPackage>[0];
/** A listed key package published at `at` (or never), with a 84-day lifetime. */
const listed = (ref: number, at?: number, used = false) =>
  ({
    keyPackageRef: new Uint8Array([ref]),
    used,
    publicPackage: { leafNode: { lifetime: { notBefore: 0n, notAfter: 10n ** 12n } } },
    published: at === undefined ? [] : [{ id: String(ref), created_at: at, tags: [] }],
  }) as unknown as Listed;

describe('marmotKeyPackageLifecycle', () => {
  beforeAll(() => installMarmotCryptoProvider());
  afterEach(() => jest.restoreAllMocks());

  it('publishes into our slot, refreshes weekly in place, and keeps the unused old secret', async () => {
    const relay = makeRelay();
    const { client } = makeClient(relay.network);

    expect(await maintain(client)).toBe('published');
    expect(await maintain(client)).toBe('unchanged'); // fresh: nothing to do
    const first = currentKeyPackage(await client.keyPackages.list())!;

    // A week later: a new key package in the SAME slot (relays replace it).
    advance(KEY_PACKAGE_REFRESH_SECS + 60);
    expect(await maintain(client)).toBe('published');
    const kpEvents = relay.events.filter((e) => e.kind === 30443);
    expect(kpEvents).toHaveLength(2);
    expect(kpEvents.every((e) => e.tags.some((t) => t[0] === 'd' && t[1] === SLOT))).toBe(true);
    const current = currentKeyPackage(await client.keyPackages.list())!;
    expect(current.keyPackageRef).not.toEqual(first.keyPackageRef);

    // The superseded one's private material is still held (in-flight invites).
    expect(await client.keyPackages.getPrivateKey(first.keyPackageRef)).not.toBeNull();
  }, 60_000);

  it('opens a Welcome sent to the key package we have since replaced', async () => {
    const relay = makeRelay();
    const bob = makeClient(relay.network);
    const alice = makeClient(relay.network);
    await maintain(bob.client);
    const oldEvent = relay.events.find((e) => e.kind === 30443 && e.pubkey === bob.pubkey)!;
    // Bob refreshes before Alice's invite (made with the old event) arrives.
    advance(KEY_PACKAGE_REFRESH_SECS + 60);
    await maintain(bob.client);

    const group = await alice.client.groups.create('', { relays: [RELAY] });
    await alice.client.groups.invite(group.id, oldEvent);
    const wrap = relay.events.find((e) => e.kind === 1059)!;
    const welcomeRumor = nip59.unwrapEvent(wrap, bob.sk) as unknown as NostrEvent;
    const { group: joined } = await bob.client.joinGroupFromWelcome({ welcomeRumor });
    expect(joined.idStr).toBe(group.idStr);
  }, 60_000);

  it('drops private material only once the key package has expired', async () => {
    const relay = makeRelay();
    const { client } = makeClient(relay.network);
    await maintain(client);
    const first = currentKeyPackage(await client.keyPackages.list())!;
    const notAfter = Number(getKeyPackageLifetime(first.published![0])!.notAfter);

    advance(notAfter + 2 * 60 * 60 - Math.floor(realNow() / 1000));
    await maintain(client);
    const refs = (await client.keyPackages.list()).map((kp) => kp.keyPackageRef.join());
    expect(refs).not.toContain(first.keyPackageRef.join());
    expect(refs).toHaveLength(1); // the fresh replacement survives
  }, 60_000);

  it('needsRefresh: a week old or past half its lifetime', () => {
    const t = 1_800_000_000;
    const kp = (publishedAt: number, notBefore: number, notAfter: number) =>
      ({
        keyPackageRef: new Uint8Array(),
        publicPackage: { leafNode: { lifetime: { notBefore, notAfter } } },
        published: [{ created_at: publishedAt, tags: [] }],
      }) as unknown as Parameters<typeof needsRefresh>[0];
    expect(needsRefresh(kp(t, t, t + 84 * DAY), t + 6 * DAY)).toBe(false);
    expect(needsRefresh(kp(t, t, t + 84 * DAY), t + 7 * DAY)).toBe(true);
    // A short-lived key package refreshes at half-life, before the week is up.
    expect(needsRefresh(kp(t, t, t + 4 * DAY), t + 2 * DAY)).toBe(true);
    expect(needsRefresh(kp(t, t, t + 4 * DAY), t + DAY)).toBe(false);
  });

  it('newestEvent: newest created_at wins, lower id breaks a tie (#1202)', () => {
    const e = (id: string, created_at: number) => ({ id, created_at });
    expect(newestEvent([e('b', 1), e('a', 3), e('c', 2)])?.id).toBe('a');
    expect(newestEvent([e('d', 5), e('c', 5)])?.id).toBe('c');
    expect(newestEvent([])).toBeUndefined();
  });

  it('retention: an unused replaced key is kept for exactly 30 days after it was replaced', () => {
    const t = 1_800_000_000;
    const old = listed(1, t);
    const current = listed(2, t + 7 * DAY);
    const list = [old, current];
    const replaced = t + 7 * DAY;
    expect(UNUSED_REPLACED_KEY_RETENTION_SECS).toBe(30 * DAY);
    expect(shouldDeleteReplacedKeyPackage(old, current, list, replaced + 30 * DAY - 1)).toBe(false);
    expect(shouldDeleteReplacedKeyPackage(old, current, list, replaced + 30 * DAY)).toBe(true);
  });

  it('retention: measured from when the key was replaced, not from the newest refresh', () => {
    const t = 1_800_000_000;
    const a = listed(1, t);
    const b = listed(2, t + 7 * DAY); // replaced `a`
    const c = listed(3, t + 14 * DAY); // current
    const list = [a, b, c];
    expect(shouldDeleteReplacedKeyPackage(a, c, list, t + 37 * DAY)).toBe(true);
    expect(shouldDeleteReplacedKeyPackage(b, c, list, t + 37 * DAY)).toBe(false);
  });

  it('retention: used and never-published keys go as soon as a replacement is confirmed', () => {
    const t = 1_800_000_000;
    const current = listed(2, t + DAY);
    expect(shouldDeleteReplacedKeyPackage(listed(1, t, true), current, [], t + DAY)).toBe(true);
    expect(shouldDeleteReplacedKeyPackage(listed(1), current, [], t + DAY)).toBe(true);
    // Nothing newer than "current" is ever retired, nor current itself.
    expect(shouldDeleteReplacedKeyPackage(listed(3, t + 2 * DAY, true), current, [], t)).toBe(
      false,
    );
    expect(shouldDeleteReplacedKeyPackage(current, current, [], t + 99 * DAY)).toBe(false);
    // A used key published in the same second as its replacement still goes.
    expect(shouldDeleteReplacedKeyPackage(listed(4, t + DAY, true), current, [], t + DAY)).toBe(
      true,
    );
  });

  it('deletes a USED key package once its replacement is published (spec)', async () => {
    const relay = makeRelay();
    const bob = makeClient(relay.network);
    const alice = makeClient(relay.network);
    await maintain(bob.client);
    const kp = relay.events.find((e) => e.kind === 30443 && e.pubkey === bob.pubkey)!;
    const group = await alice.client.groups.create('', { relays: [RELAY] });
    await alice.client.groups.invite(group.id, kp);
    const wrap = relay.events.find((e) => e.kind === 1059)!;
    const welcomeRumor = nip59.unwrapEvent(wrap, bob.sk) as unknown as NostrEvent;
    await bob.client.joinGroupFromWelcome({ welcomeRumor });
    const used = (await bob.client.keyPackages.list()).find((k) => k.used)!;
    expect(used).toBeDefined();

    expect(await maintain(bob.client)).toBe('published'); // the used one is no longer current
    expect(await bob.client.keyPackages.getPrivateKey(used.keyPackageRef)).toBeNull();
    expect(await bob.client.keyPackages.list()).toHaveLength(1);
  }, 60_000);

  it('deletes an unused replaced key 30 days after its replacement, not before', async () => {
    const relay = makeRelay();
    const { client } = makeClient(relay.network);
    await maintain(client);
    const first = currentKeyPackage(await client.keyPackages.list())!;
    advance(KEY_PACKAGE_REFRESH_SECS + 60);
    await maintain(client); // replaced now
    advance(KEY_PACKAGE_REFRESH_SECS + 60 + UNUSED_REPLACED_KEY_RETENTION_SECS - 3600);
    await maintain(client);
    expect(await client.keyPackages.getPrivateKey(first.keyPackageRef)).not.toBeNull();
    advance(KEY_PACKAGE_REFRESH_SECS + 60 + UNUSED_REPLACED_KEY_RETENTION_SECS + 3600);
    await maintain(client);
    expect(await client.keyPackages.getPrivateKey(first.keyPackageRef)).toBeNull();
  }, 60_000);

  it('keeps everything when no relay accepted the replacement', async () => {
    const relay = makeRelay();
    const { client } = makeClient(relay.network);
    await maintain(client);
    const before = (await client.keyPackages.list()).map((k) => k.keyPackageRef.join());
    advance(KEY_PACKAGE_REFRESH_SECS + 60);
    expect(await maintain(client, { wasAccepted: () => false })).toBe('failed');
    const after = (await client.keyPackages.list()).map((k) => k.keyPackageRef.join());
    expect(after).toEqual(before); // the old one kept, the unaccepted one dropped
  }, 60_000);

  it('stops at the next step once cancelled (sign-out)', async () => {
    const relay = makeRelay();
    const { client } = makeClient(relay.network);
    await expect(maintain(client, { cancelled: () => true })).rejects.toBeInstanceOf(
      KeyPackageMaintenanceCancelled,
    );
    let stopped = false;
    const create = client.keyPackages.create.bind(client.keyPackages);
    jest.spyOn(client.keyPackages, 'create').mockImplementation(async (o) => {
      const r = await create(o);
      stopped = true; // sign-out lands while the publish is in flight
      return r;
    });
    const remove = jest.spyOn(client.keyPackages, 'remove');
    await expect(maintain(client, { cancelled: () => stopped })).rejects.toBeInstanceOf(
      KeyPackageMaintenanceCancelled,
    );
    expect(remove).not.toHaveBeenCalled();
  }, 60_000);

  it('SingleFlight: one run at a time; asking mid-run queues exactly one rerun', async () => {
    let runs = 0;
    let release!: () => void;
    const flight = new SingleFlight(async () => {
      runs++;
      if (runs === 1) await new Promise<void>((resolve) => (release = resolve));
    });
    const first = flight.run();
    const [a, b] = [flight.run(), flight.run()]; // e.g. a join spent our key mid-run
    expect(a).toBe(b);
    expect(flight.current).toBe(a);
    release();
    await Promise.all([first, a, b]);
    expect(runs).toBe(2);
    expect(flight.current).toBeNull();
  });

  it('dates each key package after the previous one, so a same-second replacement wins', async () => {
    const signed: number[] = [];
    const signer = monotonicKeyPackageSigner({
      getPublicKey: () => 'pk',
      signEvent: async (d: { created_at: number }) => {
        signed.push(d.created_at);
        return d;
      },
    } as never);
    const draft = (kind: number, d = SLOT) => ({
      kind,
      created_at: 100,
      tags: [['d', d]],
      content: '',
    });
    await signer.signEvent(draft(30443));
    await signer.signEvent(draft(30443)); // same slot, same second: bumped
    await signer.signEvent(draft(30443, 'other')); // another slot (e.g. a retirement): exact
    await signer.signEvent(draft(1)); // other kinds untouched
    expect(signed).toEqual([100, 101, 100, 100]);
  });

  it('republishes when the NEWEST key package was consumed, even with an older unused one retained', async () => {
    const relay = makeRelay();
    const { client } = makeClient(relay.network);
    await maintain(client); // A
    const a = currentKeyPackage(await client.keyPackages.list())!;
    advance(60);
    // B replaces A early (A lacked a capability); A stays retained and fresh.
    await maintain(client, {
      isUpToDate: (events) => !events.some((e) => e.id === a.published![0].id),
    });
    const b = currentKeyPackage(await client.keyPackages.list(), SLOT)!;
    expect(b.keyPackageRef).not.toEqual(a.keyPackageRef);
    await client.keyPackages.markUsed(b.keyPackageRef); // a join spent B
    advance(DAY); // both well inside the weekly refresh — only B's use makes it stale

    expect(currentKeyPackage(await client.keyPackages.list(), SLOT)).toBeUndefined();
    expect(await maintain(client)).toBe('published');
    expect(await client.keyPackages.getPrivateKey(b.keyPackageRef)).toBeNull(); // used: gone
    expect(await client.keyPackages.getPrivateKey(a.keyPackageRef)).not.toBeNull(); // < 30 days
  }, 60_000);
});
