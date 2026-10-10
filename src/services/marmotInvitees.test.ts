// Which of a contact's devices get invited: real kind-30443 key packages,
// one MarmotClient per "install" sharing an account key.
import { MarmotClient, type GroupPublishResult } from '@internet-privacy/marmot-ts';
import { InMemoryKeyValueStore } from '@internet-privacy/marmot-ts/extra';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import type { Event as NostrEvent } from 'nostr-tools';

import { installMarmotCryptoProvider, marmotCryptoProvider } from './marmotCryptoProvider';
import {
  checkWelcomeDelivery,
  DEVICE_MAX_AGE_SECS,
  devicesForDm,
  MarmotWelcomeDeliveryError,
  MAX_DEVICES_PER_PERSON,
  resolveInvitees,
  selectDeviceKeyPackages,
} from './marmotInvitees';
import { MarmotNoKeyPackageError, MarmotUnusableKeyPackageError } from './marmotKeyPackages';

const RELAY = 'wss://relay.test';
const DAY = 24 * 60 * 60;
const slot = (n: number) => n.toString(16).padStart(64, '0');

function makeAccount() {
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
  return { sk, pubkey, signer };
}

/** One install of `account` publishing its key package into slot `d`. */
async function publishDevice(account: ReturnType<typeof makeAccount>, d: string) {
  const published: NostrEvent[] = [];
  const client = new MarmotClient({
    signer: account.signer,
    network: {
      publish: async (relays: string[], e: NostrEvent) => {
        published.push(e);
        return Object.fromEntries(relays.map((r) => [r, { from: r, ok: true }]));
      },
      request: async () => [],
      subscription: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
      getUserInboxRelays: async () => [RELAY],
    },
    cryptoProvider: marmotCryptoProvider,
    groupStateStore: new InMemoryKeyValueStore(),
    keyPackageStore: new InMemoryKeyValueStore(),
  });
  await client.keyPackages.create({ relays: [RELAY], identifier: d, client: 'test' });
  const kp = published.find((e) => e.kind === 30443);
  if (!kp) throw new Error('no key package published');
  return kp;
}

/** Same key package content, re-signed by `sk` with a different date. */
const resign = (e: NostrEvent, sk: Uint8Array, createdAt = e.created_at) =>
  finalizeEvent({ kind: e.kind, tags: e.tags, content: e.content, created_at: createdAt }, sk);

describe('selectDeviceKeyPackages', () => {
  beforeAll(() => installMarmotCryptoProvider());
  const little = makeAccount();
  let devices: NostrEvent[] = [];
  const now = Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    devices = [];
    for (let i = 0; i < 12; i++) devices.push(await publishDevice(little, slot(i)));
  }, 60_000);

  it('invites one key package per device, newest first', async () => {
    const [a, b] = devices;
    const olderA = resign(a, little.sk, a.created_at - 60);
    const picked = await selectDeviceKeyPackages(little.pubkey, [
      olderA,
      resign(b, little.sk, b.created_at - 10),
      a,
    ]);
    // Slot A's replaced event is dropped; both devices remain, newest first.
    expect(picked.map((e) => e.id)).toEqual([a.id, expect.any(String)]);
    expect(picked).toHaveLength(2);
    expect(picked.map((e) => e.id)).not.toContain(olderA.id);
  });

  it('drops devices older than 30 days, but keeps the newest if all are stale', async () => {
    const fresh = devices[0];
    const stale = resign(devices[1], little.sk, now - DEVICE_MAX_AGE_SECS - DAY);
    const picked = await selectDeviceKeyPackages(little.pubkey, [stale, fresh], { nowSecs: now });
    expect(picked.map((e) => e.id)).toEqual([fresh.id]);

    const staler = resign(devices[2], little.sk, now - DEVICE_MAX_AGE_SECS - 2 * DAY);
    const onlyStale = await selectDeviceKeyPackages(little.pubkey, [staler, stale], {
      nowSecs: now,
    });
    expect(onlyStale.map((e) => e.id)).toEqual([stale.id]);
  });

  it('caps a person at 10 devices, keeping the newest', async () => {
    const dated = devices.map((e, i) => resign(e, little.sk, now - i * 60));
    const picked = await selectDeviceKeyPackages(little.pubkey, dated, { nowSecs: now });
    expect(picked).toHaveLength(MAX_DEVICES_PER_PERSON);
    expect(picked.map((e) => e.id)).toEqual(dated.slice(0, 10).map((e) => e.id));
  });

  it('rejects bad signatures, expired keys and a foreign credential', async () => {
    const good = devices[0];
    const badSig = { ...JSON.parse(JSON.stringify(devices[1])), sig: '0'.repeat(128) };
    // Little's key package re-signed by someone else: the credential inside
    // still names Little, so it must not be accepted as theirs.
    const mallory = makeAccount();
    const foreign = resign(devices[2], mallory.sk);
    expect(await selectDeviceKeyPackages(little.pubkey, [badSig, good])).toEqual([good]);
    await expect(selectDeviceKeyPackages(mallory.pubkey, [foreign])).rejects.toBeInstanceOf(
      MarmotUnusableKeyPackageError,
    );
    // Someone else's events never count as this person's devices.
    expect(await selectDeviceKeyPackages(little.pubkey, [foreign, good])).toEqual([good]);
    // A year on, every lifetime has run out.
    await expect(
      selectDeviceKeyPackages(little.pubkey, [good], { nowSecs: now + 365 * DAY }),
    ).rejects.toBeInstanceOf(MarmotUnusableKeyPackageError);
    expect(await selectDeviceKeyPackages(little.pubkey, [])).toEqual([]);
  });

  it('1:1s with a White Noise user get their newest White Noise device only', async () => {
    const asClient = (e: NostrEvent, client: string, createdAt: number) =>
      finalizeEvent(
        {
          kind: e.kind,
          content: e.content,
          created_at: createdAt,
          tags: [...e.tags.filter((t) => t[0] !== 'client'), ['client', client]],
        },
        little.sk,
      );
    const lpPhone = asClient(devices[0], 'Lightning Piggy', now);
    const lpTablet = asClient(devices[1], 'Lightning Piggy', now - 60);
    const wnNew = asClient(devices[2], 'White Noise Android', now - 120);
    const wnOld = asClient(devices[3], 'White Noise Android', now - 180);
    const all = await selectDeviceKeyPackages(little.pubkey, [wnOld, lpTablet, wnNew, lpPhone], {
      nowSecs: now,
    });
    expect(all).toHaveLength(4);
    // White Noise counts leaves to spot a DM: one White Noise device keeps it a DM there.
    expect(devicesForDm(all)).toEqual([wnNew]);
    // Lightning Piggy-only contacts get every device in a 1:1 too.
    expect(devicesForDm([lpPhone, lpTablet])).toEqual([lpPhone, lpTablet]);
  });

  it('yields between signature checks', async () => {
    const yieldNow = jest.fn();
    await selectDeviceKeyPackages(little.pubkey, devices.slice(0, 3), { yieldNow });
    expect(yieldNow).toHaveBeenCalledTimes(3);
  });

  it('resolves every peer (never ourselves) and names anyone unreachable', async () => {
    const big = makeAccount();
    const middle = makeAccount();
    const ownOtherInstall = await publishDevice(big, slot(99));
    const network = {
      request: jest.fn(async (_relays: string[], filter: unknown) => {
        const f = filter as { kinds: number[]; authors: string[]; limit?: number };
        expect(typeof f.limit).toBe('number'); // bounded (perf rules)
        if (!f.kinds.includes(30443)) return [];
        return [...devices.slice(0, 2), ownOtherInstall].filter((e) =>
          f.authors.includes(e.pubkey),
        );
      }),
    };
    const invitees = await resolveInvitees(network, [RELAY], big.pubkey, [
      little.pubkey,
      big.pubkey,
    ]);
    expect([...invitees.keys()]).toEqual([little.pubkey]);
    expect(invitees.get(little.pubkey)).toHaveLength(2);
    await expect(
      resolveInvitees(network, [RELAY], big.pubkey, [little.pubkey, middle.pubkey]),
    ).rejects.toBeInstanceOf(MarmotNoKeyPackageError);
  });
});

describe('checkWelcomeDelivery', () => {
  const recipient = (id: string) => ({ pubkey: 'a'.repeat(64), keyPackageEventId: id });
  const result = (outcomes: { kind: 'succeeded' | 'failed'; id: string }[]) =>
    [
      {
        welcomeDelivery: {
          kind: 'attempted',
          outcomes: outcomes.map((o) =>
            o.kind === 'failed'
              ? { kind: 'failed', recipient: recipient(o.id), error: 'relay said no' }
              : { kind: 'succeeded', recipient: recipient(o.id), response: {} },
          ),
        },
      },
    ] as unknown as GroupPublishResult[];

  it('tolerates some devices missing their Welcome, throws only when all fail', () => {
    expect(() =>
      checkWelcomeDelivery(
        result([
          { kind: 'succeeded', id: '1'.repeat(64) },
          { kind: 'failed', id: '2'.repeat(64) },
        ]),
      ),
    ).not.toThrow();
    expect(() =>
      checkWelcomeDelivery(
        result([
          { kind: 'failed', id: '1'.repeat(64) },
          { kind: 'failed', id: '2'.repeat(64) },
        ]),
      ),
    ).toThrow(MarmotWelcomeDeliveryError);
    expect(() =>
      checkWelcomeDelivery([{ welcomeDelivery: { kind: 'notRequired' } }] as GroupPublishResult[]),
    ).not.toThrow();
  });
});
