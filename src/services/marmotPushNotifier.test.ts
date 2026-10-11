import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { Buffer } from 'buffer';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

import * as marmotPush from './marmotPush';
import { leafKey, ownerProofEventId, type PushRecord } from './marmotPush';
import { MarmotPushNotifier, type PushGroup } from './marmotPushNotifier';
import { createMemoryMarmotBackend } from './marmotStore';

jest.mock('../contexts/nostrDecryptPacing', () => ({
  createYieldScheduler: () => ({
    maybeYield: async () => undefined,
    yieldCount: 0,
    dispose: () => undefined,
  }),
}));

const GROUP_HEX = 'cd'.repeat(16);
const me = getPublicKey(generateSecretKey());
const bobSk = generateSecretKey();
const bob = getPublicKey(bobSk);
const SERVER = 'ee'.repeat(32);

function tokenPayload(over: Partial<PushRecord> = {}) {
  const r: PushRecord = {
    member: bob, leaf: 1, platform: 'fcm', fingerprint: 'sha256:' + 'ab'.repeat(12), server: SERVER,
    encryptedToken: Buffer.alloc(1084, 9).toString('base64'), ownerTs: Date.now() - 1000, ownerSig: '', ...over,
  }; // prettier-ignore
  const sig = bytesToHex(schnorr.sign(hexToBytes(ownerProofEventId(r, GROUP_HEX)), bobSk));
  return JSON.stringify({
    v: 'marmot-push-v1',
    tokens: [{
      member_id_hex: r.member, leaf_index: r.leaf, platform: r.platform, token_fingerprint: r.fingerprint,
      server_pubkey_hex: r.server, ...(r.relayHint ? { relay_hint: r.relayHint } : {}),
      encrypted_token: r.encryptedToken, owner_ts: r.ownerTs, owner_sig: sig,
    }], // prettier-ignore
  });
}

function setup() {
  const published: { relays: string[]; kind: number }[] = [];
  const transport = {
    publish: jest.fn(async (relays: string[], event: { kind: number }) => {
      published.push({ relays, kind: event.kind });
    }),
    inboxRelays: jest.fn<Promise<string[]>, [string]>(async () => ['wss://server-inbox.example']),
  };
  const notifier = new MarmotPushNotifier({
    pubkey: me,
    backend: createMemoryMarmotBackend(),
    transport,
  });
  const group = (leaves: string[]): PushGroup => ({
    idHex: GROUP_HEX,
    id: hexToBytes(GROUP_HEX),
    leaves: new Set(leaves),
  });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { notifier, transport, published, group, settle };
}

describe('MarmotPushNotifier', () => {
  it("publishes a trigger to the record's relay hint plus the server's own inbox", async () => {
    const { notifier, published, group, settle } = setup();
    const g = group([leafKey(me, 0), leafKey(bob, 1)]);
    await notifier.ingest(g, 447, tokenPayload({ relayHint: 'wss://relay.eu.whitenoise.chat' }));
    notifier.trigger(g);
    await settle();
    expect(published).toEqual([
      { relays: ['wss://relay.eu.whitenoise.chat', 'wss://server-inbox.example'], kind: 1059 },
    ]);
  });

  it("falls back to the server's own inbox relays when no record has a hint", async () => {
    const { notifier, published, group, settle, transport } = setup();
    const g = group([leafKey(bob, 1)]);
    await notifier.ingest(g, 448, tokenPayload());
    notifier.trigger(g);
    await settle();
    expect(transport.inboxRelays).toHaveBeenCalledWith(SERVER);
    expect(published).toEqual([{ relays: ['wss://server-inbox.example'], kind: 1059 }]);
  });

  it("a stale hint on one device's record doesn't strand a hint-less device on the same server", async () => {
    const { notifier, published, group, settle } = setup();
    const g = group([leafKey(bob, 1), leafKey(bob, 2)]);
    // An older build still advertising the dead nos.lol, and a current build with no hint.
    await notifier.ingest(g, 448, tokenPayload({ leaf: 1, relayHint: 'wss://nos.lol' }));
    await notifier.ingest(g, 448, tokenPayload({ leaf: 2 }));
    notifier.trigger(g);
    await settle();
    expect(published).toEqual([
      { relays: ['wss://nos.lol', 'wss://server-inbox.example'], kind: 1059 },
    ]);
  });

  it("publishes nothing when there's no hint and the server's 10050 can't be found", async () => {
    const { notifier, published, group, settle, transport } = setup();
    transport.inboxRelays.mockRejectedValueOnce(new Error('timeout'));
    const g = group([leafKey(bob, 1)]);
    await notifier.ingest(g, 448, tokenPayload());
    notifier.trigger(g);
    await settle();
    expect(published).toEqual([]);
  });

  it('never wakes our own devices, and forgets a member whose leaf left', async () => {
    const { notifier, published, group, settle } = setup();
    await notifier.ingest(group([leafKey(bob, 1)]), 447, tokenPayload());
    await notifier.reconcile(group([leafKey(me, 0)])); // Bob removed
    notifier.trigger(group([leafKey(me, 0), leafKey(bob, 1)])); // same leaf re-occupied
    await settle();
    expect(published).toEqual([]);
  });

  it('a trigger right after an ingest sees that ingest (one chain per group)', async () => {
    const { notifier, published, group, settle } = setup();
    const g = group([leafKey(bob, 1)]);
    void notifier.ingest(g, 447, tokenPayload({ relayHint: 'wss://r.example' }));
    notifier.trigger(g); // not awaited: must still run after the ingest
    await settle();
    expect(published).toHaveLength(1);
  });

  it('one failing server does not cost the other servers their triggers', async () => {
    const { notifier, published, group, settle } = setup();
    const OTHER = getPublicKey(generateSecretKey());
    const g = group([leafKey(bob, 1), leafKey(bob, 2)]);
    await notifier.ingest(g, 448, tokenPayload({ leaf: 1, server: OTHER }));
    await notifier.ingest(g, 448, tokenPayload({ leaf: 2 }));
    const real = marmotPush.buildTriggerWraps;
    const spy = jest
      .spyOn(marmotPush, 'buildTriggerWraps')
      .mockImplementation(function* (server, tokens) {
        if (server === OTHER) throw new Error('bad server key');
        yield* real(server, tokens);
      });
    notifier.trigger(g);
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
    // The failing server is tried FIRST, so the valid one only publishes if
    // the failure is isolated.
    expect(spy.mock.calls[0][0]).toBe(OTHER);
    expect(published).toEqual([{ relays: ['wss://server-inbox.example'], kind: 1059 }]);
    spy.mockRestore();
  });

  it('looks up every server 10050 in parallel, not one after another', async () => {
    const { notifier, published, group, settle, transport } = setup();
    const SLOW = getPublicKey(generateSecretKey());
    let release: (r: string[]) => void = () => undefined;
    transport.inboxRelays.mockImplementation(async (server: string) =>
      server === SLOW
        ? new Promise<string[]>((r) => (release = r))
        : ['wss://server-inbox.example'],
    );
    const g = group([leafKey(bob, 1), leafKey(bob, 2)]);
    await notifier.ingest(g, 448, tokenPayload({ leaf: 1, server: SLOW }));
    await notifier.ingest(g, 448, tokenPayload({ leaf: 2 }));
    notifier.trigger(g);
    await settle();
    // Both lookups started while the first is still pending.
    expect(transport.inboxRelays).toHaveBeenCalledTimes(2);
    expect(published).toEqual([]);
    release(['wss://slow-inbox.example']);
    await settle();
    expect(published.map((p) => p.relays)).toEqual(
      expect.arrayContaining([['wss://server-inbox.example'], ['wss://slow-inbox.example']]),
    );
  });

  it('after stop(), a paused ingest writes nothing and queued triggers never publish', async () => {
    const backend = createMemoryMarmotBackend();
    const transport = {
      publish: jest.fn(async () => undefined),
      inboxRelays: jest.fn(async () => ['wss://x']),
    };
    const notifier = new MarmotPushNotifier({ pubkey: me, backend, transport });
    const g: PushGroup = {
      idHex: GROUP_HEX,
      id: hexToBytes(GROUP_HEX),
      leaves: new Set([leafKey(bob, 1)]),
    };
    const ingest = notifier.ingest(g, 448, tokenPayload()); // queued behind its signature check
    notifier.trigger(g);
    await notifier.stop();
    await ingest;
    await new Promise((r) => setTimeout(r, 20));
    expect(await backend.get('pushRecords', GROUP_HEX)).toBeNull();
    expect(transport.publish).not.toHaveBeenCalled();
  });
});
