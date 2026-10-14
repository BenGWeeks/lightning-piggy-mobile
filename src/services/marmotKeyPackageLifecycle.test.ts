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
  currentKeyPackage,
  maintainKeyPackage,
  monotonicKeyPackageSigner,
  needsRefresh,
  shouldDeleteReplacedKeyPackage,
  trackKeyPackageAcceptance,
} from './marmotKeyPackageLifecycle';
import { newestEvent } from './marmotKeyPackages';
import { rememberKeyPackageTimestamp } from './marmotInstallationSlot';

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

  it('rotation keeps one slot and deletes the old secret after confirmed publication', async () => {
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

    // Confirmed replacement immediately deletes superseded private material.
    expect(await client.keyPackages.getPrivateKey(first.keyPackageRef)).toBeNull();
    expect(await client.keyPackages.list()).toHaveLength(1);
  }, 60_000);

  it('rejects a delayed Welcome for a replaced key; the inviter must retry', async () => {
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
    await expect(bob.client.joinGroupFromWelcome({ welcomeRumor })).rejects.toThrow();
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

  it('deletes unused and used replacements immediately, never before confirmation', () => {
    const t = 1_800_000_000;
    const current = listed(2, t + DAY);
    expect(shouldDeleteReplacedKeyPackage(listed(1, t), current)).toBe(true);
    expect(shouldDeleteReplacedKeyPackage(listed(1, t, true), current)).toBe(true);
    expect(shouldDeleteReplacedKeyPackage(listed(1), current)).toBe(true);
    expect(shouldDeleteReplacedKeyPackage(current, current)).toBe(false);
    expect(shouldDeleteReplacedKeyPackage(listed(1, t), listed(2))).toBe(false);
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

  it('retires older locally owned slots with NIP-09 and deletes their secrets', async () => {
    const relay = makeRelay();
    const { client } = makeClient(relay.network);
    const legacySlot = 'cd'.repeat(32);
    const legacy = await client.keyPackages.create({ relays: [RELAY], identifier: legacySlot });
    expect(await maintain(client)).toBe('published');
    const deletion = relay.events.find((e) => e.kind === 5)!;
    expect(deletion.tags).toContainEqual(['a', `30443:${deletion.pubkey}:${legacySlot}`]);
    expect(deletion.tags).not.toContainEqual(['a', `30443:${deletion.pubkey}:${SLOT}`]);
    expect(await client.keyPackages.getPrivateKey(legacy.keyPackageRef)).toBeNull();
    expect(await client.keyPackages.list()).toHaveLength(1);
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

  it('keeps the previous secret until relay publication finishes', async () => {
    const relay = makeRelay();
    const { client } = makeClient(relay.network);
    await maintain(client);
    const previous = currentKeyPackage(await client.keyPackages.list())!;
    const publish = relay.network.publish;
    let release!: () => void;
    let entered!: () => void;
    const publishing = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    relay.network.publish = async (relays, event) => {
      if (event.kind === 30443) {
        entered();
        await gate;
      }
      return publish(relays, event);
    };
    advance(KEY_PACKAGE_REFRESH_SECS + 60);
    const replacement = maintain(client);
    await publishing;
    expect(await client.keyPackages.getPrivateKey(previous.keyPackageRef)).not.toBeNull();
    release();
    await replacement;
    expect(await client.keyPackages.getPrivateKey(previous.keyPackageRef)).toBeNull();
    expect(await client.keyPackages.list()).toHaveLength(1);
  }, 60_000);

  it('retries retirement of owned legacy slots when no relay accepts their deletion', async () => {
    const relay = makeRelay();
    const publish = relay.network.publish;
    let rejectDeletion = true;
    relay.network.publish = async (relays, event) =>
      event.kind === 5 && rejectDeletion
        ? Object.fromEntries(relays.map((r) => [r, { from: r, ok: false }]))
        : publish(relays, event);
    const accepted = new Set<string>();
    const { client } = makeClient(trackKeyPackageAcceptance(relay.network, accepted));
    const legacy = await client.keyPackages.create({
      relays: [RELAY],
      identifier: 'cd'.repeat(32),
    });
    // The fresh slot publishes; the rejected retirement is deferred, not a failure.
    await expect(maintain(client, { wasAccepted: (id) => accepted.has(id) })).resolves.toBe(
      'published',
    );
    expect(await client.keyPackages.getPrivateKey(legacy.keyPackageRef)).not.toBeNull();
    rejectDeletion = false;
    await maintain(client);
    expect(await client.keyPackages.list()).toHaveLength(1);
    expect(await client.keyPackages.getPrivateKey(legacy.keyPackageRef)).toBeNull();
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

  it('re-sign-in publishes after the persisted retirement tombstone', async () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const signer = {
      getPublicKey: () => pubkey,
      signEvent: (draft: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(draft, sk),
    };
    const draft = { kind: 30443, created_at: 100, tags: [['d', SLOT]], content: '' };
    const first = await monotonicKeyPackageSigner(signer).signEvent(draft);
    // Sign-out publishes an empty slot replacement, then wipes account state.
    await rememberKeyPackageTimestamp({ ...first, created_at: 102 });
    const next = await monotonicKeyPackageSigner(signer).signEvent(draft);
    expect(next.created_at).toBe(103);
    expect(next.tags).toEqual(first.tags);
  });

  it('republishes when the newest key package is consumed and earlier secrets are erased', async () => {
    const relay = makeRelay();
    const { client } = makeClient(relay.network);
    await maintain(client); // A
    const a = currentKeyPackage(await client.keyPackages.list())!;
    advance(60);
    // B replaces A early (A lacked a capability); A is immediately erased.
    await maintain(client, {
      isUpToDate: (events) => !events.some((e) => e.id === a.published![0].id),
    });
    const b = currentKeyPackage(await client.keyPackages.list(), SLOT)!;
    expect(b.keyPackageRef).not.toEqual(a.keyPackageRef);
    await client.keyPackages.markUsed(b.keyPackageRef); // a join spent B
    advance(DAY); // inside the weekly refresh — B's use makes it stale

    expect(currentKeyPackage(await client.keyPackages.list(), SLOT)).toBeUndefined();
    expect(await maintain(client)).toBe('published');
    expect(await client.keyPackages.getPrivateKey(b.keyPackageRef)).toBeNull(); // used: gone
    expect(await client.keyPackages.getPrivateKey(a.keyPackageRef)).toBeNull(); // confirmed replacement
  }, 60_000);
});
