import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

import { applyPushPayload, leafKey, parsePushPayload, type PushRecordState } from './marmotPush';
import type { DeviceRegistration, Sign } from './marmotPushEntries';
import { MarmotPushRegistrar, planGroup, type RegistrarGroup } from './marmotPushRegistrar';
import { tokenFingerprint } from './marmotPushToken';
import { createMemoryMarmotBackend } from './marmotStore';

const SERVER_A = bytesToHex(schnorr.getPublicKey(new Uint8Array(32).fill(0x44)));
const SERVER_B = bytesToHex(schnorr.getPublicKey(new Uint8Array(32).fill(0x45)));
const sk = generateSecretKey();
const ME = getPublicKey(sk);
const PEER = 'cd'.repeat(32);

const reg = (raw: string, server = SERVER_A): DeviceRegistration => {
  const token = utf8ToBytes(raw);
  return {
    platform: 'fcm',
    token,
    fingerprint: tokenFingerprint('fcm', token),
    server,
    relayHint: 'wss://nos.lol',
  };
};

const group = (idHex: string, ownLeaf = 0, peers = [1]): RegistrarGroup => ({
  idHex,
  ownLeaf,
  leaves: new Set([leafKey(ME, ownLeaf), ...peers.map((l) => leafKey(PEER, l))]),
});

interface Sent {
  group: string;
  kind: number;
  content: string;
}

function setup(opts: { silent?: boolean; groups?: RegistrarGroup[]; refuse?: boolean } = {}) {
  let groups = opts.groups ?? [group('aa'.repeat(16)), group('bb'.repeat(16))];
  const sent: Sent[] = [];
  let prompts = 0;
  let clock = 1_000;
  let refuse = opts.refuse ?? false;
  const sign: Sign = async (template) => {
    prompts++;
    if (refuse) throw new Error('rejected by user');
    return finalizeEvent({ ...template }, sk) as unknown as Awaited<ReturnType<Sign>>;
  };
  const registrar = new MarmotPushRegistrar({
    pubkey: ME,
    silentSigner: opts.silent ?? true,
    backend: createMemoryMarmotBackend(),
    ready: Promise.resolve(),
    groups: () => groups,
    sign,
    send: async (groupIdHex, event) => {
      sent.push({ group: groupIdHex, kind: event.kind, content: event.content });
      return true;
    },
    now: () => clock,
  });
  return {
    registrar,
    sent,
    prompts: () => prompts,
    tick: (ms = 1) => (clock += ms),
    setGroups: (g: RegistrarGroup[]) => (groups = g),
    setRefuse: (r: boolean) => (refuse = r),
  };
}

/** What a group member ends up with after receiving everything we sent. */
async function memberView(sent: Sent[], g: RegistrarGroup): Promise<PushRecordState> {
  let state: PushRecordState = {};
  for (const s of sent.filter((x) => x.group === g.idHex)) {
    state = await applyPushPayload(
      state,
      s.kind,
      s.content,
      { idHex: g.idHex, id: hexToBytes(g.idHex), leaves: g.leaves },
      Date.now(),
    );
  }
  return state;
}

describe('MarmotPushRegistrar', () => {
  it('publishes one verified 447 per group, then stays quiet', async () => {
    const t = setup();
    t.registrar.setRegistration(reg('token-1'));
    const first = await t.registrar.sync({ interactive: false });
    expect(first).toMatchObject({ published: 2, pending: 0 });
    expect(t.sent.map((s) => s.kind)).toEqual([447, 447]);
    for (const g of [group('aa'.repeat(16)), group('bb'.repeat(16))]) {
      const view = Object.values(await memberView(t.sent, g));
      expect(view).toHaveLength(1);
      expect(view[0].record?.leaf).toBe(0);
    }
    // Restart-equivalent: nothing changed → no signature, nothing sent.
    const again = await t.registrar.sync({ interactive: false });
    expect(again).toMatchObject({ published: 0, pending: 0 });
    expect(t.prompts()).toBe(2);
    expect(t.sent).toHaveLength(2);
  });

  it('re-sends the same signed record (no signature) when a member joins', async () => {
    const t = setup({ groups: [group('aa'.repeat(16))] });
    t.registrar.setRegistration(reg('token-1'));
    await t.registrar.sync({ interactive: false });
    t.setGroups([group('aa'.repeat(16), 0, [1, 2])]);
    await t.registrar.sync({ interactive: false });
    expect(t.prompts()).toBe(1);
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1].content).toBe(t.sent[0].content);
    // A member leaving needs nothing.
    t.setGroups([group('aa'.repeat(16), 0, [2])]);
    await t.registrar.sync({ interactive: false });
    expect(t.sent).toHaveLength(2);
  });

  it('a token rotation re-publishes with a newer owner_ts that wins — no 449', async () => {
    const g = group('aa'.repeat(16));
    const t = setup({ groups: [g] });
    t.registrar.setRegistration(reg('token-1'));
    await t.registrar.sync({ interactive: false });
    t.registrar.setRegistration(reg('token-2'));
    await t.registrar.sync({ interactive: false });
    expect(t.sent.map((s) => s.kind)).toEqual([447, 447]);
    const ts = t.sent.map((s) => parsePushPayload(447, s.content, Date.now()).records[0].ownerTs);
    expect(ts[1]).toBeGreaterThan(ts[0]);
    const view = Object.values(await memberView(t.sent, g));
    expect(view).toHaveLength(1);
    expect(view[0].record?.fingerprint).toBe(reg('token-2').fingerprint);
  });

  it('moving to another server retracts the old record key first', async () => {
    const g = group('aa'.repeat(16));
    const t = setup({ groups: [g] });
    t.registrar.setRegistration(reg('token-1', SERVER_A));
    await t.registrar.sync({ interactive: false });
    t.registrar.setRegistration(reg('token-1', SERVER_B));
    await t.registrar.sync({ interactive: false });
    expect(t.sent.map((s) => s.kind)).toEqual([447, 449, 447]);
    const live = Object.values(await memberView(t.sent, g)).filter((s) => s.record);
    expect(live.map((s) => s.record?.server)).toEqual([SERVER_B]);
  });

  it('disabling retracts everywhere and forgets what it published', async () => {
    const t = setup();
    t.registrar.setRegistration(reg('token-1'));
    await t.registrar.sync({ interactive: false });
    t.registrar.setRegistration(null);
    const result = await t.registrar.sync({ interactive: true });
    expect(result).toMatchObject({ removed: 2, pending: 0 });
    expect(t.sent.map((s) => s.kind)).toEqual([447, 447, 449, 449]);
    expect(await t.registrar.pendingCount()).toBe(0);
    for (const g of [group('aa'.repeat(16)), group('bb'.repeat(16))]) {
      expect(Object.values(await memberView(t.sent, g)).map((s) => s.record)).toEqual([null]);
    }
  });

  it('a lost leaf (re-added under a new one) needs no removal', async () => {
    const t = setup({ groups: [group('aa'.repeat(16), 0)] });
    t.registrar.setRegistration(reg('token-1'));
    await t.registrar.sync({ interactive: false });
    t.setGroups([group('aa'.repeat(16), 3)]);
    await t.registrar.sync({ interactive: false });
    expect(t.sent.map((s) => s.kind)).toEqual([447, 447]);
    expect(parsePushPayload(447, t.sent[1].content, Date.now()).records[0].leaf).toBe(3);
  });

  it('forgets groups it has left', async () => {
    const t = setup();
    t.registrar.setRegistration(reg('token-1'));
    await t.registrar.sync({ interactive: false });
    t.setGroups([group('aa'.repeat(16))]);
    await t.registrar.sync({ interactive: false });
    // Rejoining the departed group publishes afresh rather than assuming.
    t.setGroups([group('aa'.repeat(16)), group('bb'.repeat(16))]);
    const r = await t.registrar.sync({ interactive: false });
    expect(r.published).toBe(1);
  });

  describe('remote signer (Amber / NIP-46)', () => {
    it('never prompts from a background pass — groups stay pending', async () => {
      const t = setup({ silent: false });
      t.registrar.setRegistration(reg('token-1'));
      const r = await t.registrar.sync({ interactive: false });
      expect(r).toMatchObject({ published: 0, pending: 2 });
      expect(t.prompts()).toBe(0);
      expect(await t.registrar.pendingCount()).toBe(2);
    });

    it('prompts once per group on a user action', async () => {
      const t = setup({ silent: false });
      t.registrar.setRegistration(reg('token-1'));
      const r = await t.registrar.sync({ interactive: true });
      expect(r).toMatchObject({ published: 2, pending: 0 });
      expect(t.prompts()).toBe(2);
    });

    it('stops asking after the first decline', async () => {
      const t = setup({ silent: false, refuse: true });
      t.registrar.setRegistration(reg('token-1'));
      const r = await t.registrar.sync({ interactive: true });
      expect(r).toMatchObject({ published: 0, pending: 2, declined: true });
      expect(t.prompts()).toBe(1);
      t.setRefuse(false);
      const retry = await t.registrar.sync({ interactive: true });
      expect(retry).toMatchObject({ published: 2, declined: false });
    });

    it('stops asking after a signer returns nothing / a bad signature', async () => {
      let prompts = 0;
      const sent: number[] = [];
      const registrar = new MarmotPushRegistrar({
        pubkey: ME,
        silentSigner: false,
        backend: createMemoryMarmotBackend(),
        ready: Promise.resolve(),
        groups: () => [group('aa'.repeat(16)), group('bb'.repeat(16))],
        sign: async (tpl) => {
          prompts++;
          const ev = finalizeEvent({ ...tpl }, sk);
          return (prompts === 1
            ? null // Amber's "null"
            : { ...ev, sig: '00'.repeat(64) }) as unknown as Awaited<ReturnType<Sign>>;
        },
        send: async (_id, ev) => (sent.push(ev.kind), true),
      });
      registrar.setRegistration(reg('token-1'));
      const r = await registrar.sync({ interactive: true });
      expect(r).toMatchObject({ published: 0, pending: 2, declined: true });
      expect(prompts).toBe(1);
      expect(sent).toEqual([]);
    });

    it('sending in a group sets up just that group', async () => {
      const t = setup({ silent: false });
      t.registrar.setRegistration(reg('token-1'));
      t.registrar.onUserSend('bb'.repeat(16));
      await t.registrar.sync({ interactive: false }); // waits for the queued pass
      expect(t.sent.map((s) => s.group)).toEqual(['bb'.repeat(16)]);
      expect(t.prompts()).toBe(1);
    });
  });

  it('waits for the session to load its groups before touching state', async () => {
    let release!: () => void;
    const ready = new Promise<void>((r) => (release = r));
    const sent: string[] = [];
    const registrar = new MarmotPushRegistrar({
      pubkey: ME,
      silentSigner: true,
      backend: createMemoryMarmotBackend(),
      ready,
      groups: () => [group('aa'.repeat(16))],
      sign: async (tpl) => finalizeEvent({ ...tpl }, sk) as unknown as Awaited<ReturnType<Sign>>,
      send: async (id) => (sent.push(id), true),
    });
    registrar.setRegistration(reg('token-1'));
    const pass = registrar.sync({ interactive: false });
    await Promise.resolve();
    expect(sent).toEqual([]);
    release();
    await pass;
    expect(sent).toEqual(['aa'.repeat(16)]);
  });

  it('does nothing until it knows the registration (never mistakes a slow start for "off")', async () => {
    const backend = createMemoryMarmotBackend();
    const g = group('aa'.repeat(16));
    const make = (send: () => Promise<boolean>) =>
      new MarmotPushRegistrar({
        pubkey: ME,
        silentSigner: true,
        backend,
        ready: Promise.resolve(),
        groups: () => [g],
        sign: async (tpl) => finalizeEvent({ ...tpl }, sk) as unknown as Awaited<ReturnType<Sign>>,
        send,
      });
    const first = make(async () => true);
    first.setRegistration(reg('token-1'));
    expect((await first.sync({ interactive: false })).published).toBe(1);
    // Next app start, same stored state, token not re-read yet.
    const send = jest.fn(async () => true);
    const fresh = make(send);
    expect(await fresh.sync({ interactive: true })).toMatchObject({ published: 0, removed: 0 });
    expect(await fresh.pendingCount()).toBe(0);
    expect(send).not.toHaveBeenCalled();
    // Explicitly off → now it retracts.
    fresh.setRegistration(null);
    expect((await fresh.sync({ interactive: false })).removed).toBe(1);
  });

  it('a pass overtaken mid-signature (session stopped) never publishes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sent: number[] = [];
    const registrar = new MarmotPushRegistrar({
      pubkey: ME,
      silentSigner: true,
      backend: createMemoryMarmotBackend(),
      ready: Promise.resolve(),
      groups: () => [group('aa'.repeat(16)), group('bb'.repeat(16))],
      sign: async (tpl) => {
        await gate;
        return finalizeEvent({ ...tpl }, sk) as unknown as Awaited<ReturnType<Sign>>;
      },
      send: async (_id, ev) => (sent.push(ev.kind), true),
    });
    registrar.setRegistration(reg('token-1'));
    const pass = registrar.sync({ interactive: true });
    await new Promise((r) => setTimeout(r, 0));
    const stopped = registrar.stop();
    release();
    await pass;
    await stopped;
    expect(sent).toEqual([]);
  });

  it('a registration change mid-pass abandons the stale pass', async () => {
    const t = setup();
    t.registrar.setRegistration(reg('token-1'));
    const first = t.registrar.sync({ interactive: false });
    t.registrar.setRegistration(reg('token-2'));
    await first;
    await t.registrar.sync({ interactive: false });
    const live = await memberView(t.sent, group('aa'.repeat(16)));
    expect(Object.values(live).map((v) => v.record?.fingerprint)).toEqual([
      reg('token-2').fingerprint,
    ]);
  });

  it('re-enabling after a removal outranks our own tombstone, even if the clock went back', async () => {
    const g = group('aa'.repeat(16));
    const t = setup({ groups: [g] });
    t.registrar.setRegistration(reg('token-1'));
    await t.registrar.sync({ interactive: false });
    t.registrar.setRegistration(null);
    await t.registrar.sync({ interactive: true });
    t.tick(-500); // clock rollback
    t.registrar.setRegistration(reg('token-1'));
    await t.registrar.sync({ interactive: false });
    expect(t.sent.map((x) => x.kind)).toEqual([447, 449, 447]);
    const live = Object.values(await memberView(t.sent, g)).filter((v) => v.record);
    expect(live).toHaveLength(1);
  });

  it('stop() makes later passes no-ops', async () => {
    const t = setup();
    t.registrar.setRegistration(reg('token-1'));
    await t.registrar.stop();
    const r = await t.registrar.sync({ interactive: true });
    expect(r.published).toBe(0);
    expect(t.sent).toHaveLength(0);
  });
});

describe('repeated identical registrations', () => {
  it('do not abandon a pass that is publishing them', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sent: number[] = [];
    const registrar = new MarmotPushRegistrar({
      pubkey: ME,
      silentSigner: true,
      backend: createMemoryMarmotBackend(),
      ready: Promise.resolve(),
      groups: () => [group('aa'.repeat(16))],
      sign: async (tpl) => {
        await gate;
        return finalizeEvent({ ...tpl }, sk) as unknown as Awaited<ReturnType<Sign>>;
      },
      send: async (_id, ev) => (sent.push(ev.kind), true),
    });
    registrar.setRegistration(reg('token-1'));
    const pass = registrar.sync({ interactive: true });
    await new Promise((r) => setTimeout(r, 0));
    registrar.setRegistration(reg('token-1')); // same token, new object
    release();
    expect((await pass).published).toBe(1);
    expect(sent).toEqual([447]);
  });
});

describe('stopping mid-publish', () => {
  it('still records a publish that already happened, so it can be retracted later', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const backend = createMemoryMarmotBackend();
    const g = group('aa'.repeat(16));
    const signer: Sign = async (tpl) =>
      finalizeEvent({ ...tpl }, sk) as unknown as Awaited<ReturnType<Sign>>;
    const a = new MarmotPushRegistrar({
      pubkey: ME,
      silentSigner: true,
      backend,
      ready: Promise.resolve(),
      groups: () => [g],
      sign: signer,
      send: async () => {
        await gate;
        return true;
      },
    });
    a.setRegistration(reg('token-1', SERVER_A));
    const pass = a.sync({ interactive: true });
    await new Promise((r) => setTimeout(r, 0));
    const stopped = a.stop();
    release();
    await pass;
    await stopped;
    const sent: number[] = [];
    const b = new MarmotPushRegistrar({
      pubkey: ME,
      silentSigner: true,
      backend,
      ready: Promise.resolve(),
      groups: () => [g],
      sign: signer,
      send: async (_id, ev) => (sent.push(ev.kind), true),
    });
    b.setRegistration(reg('token-1', SERVER_B));
    await b.sync({ interactive: false });
    expect(sent).toEqual([449, 447]);
  });
});

describe('planGroup', () => {
  const g = group('aa'.repeat(16));
  it('is a no-op with nothing published and push off', () => {
    expect(planGroup(null, null, g)).toEqual({ type: 'none' });
  });
  it('publishes when nothing was published', () => {
    expect(planGroup(null, reg('t'), g)).toEqual({ type: 'publish' });
  });
});
