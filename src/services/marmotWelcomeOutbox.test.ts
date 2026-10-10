import type { Event as NostrEvent } from 'nostr-tools';

import { createMemoryMarmotBackend } from './marmotStore';
import { MarmotWelcomeOutbox, WELCOME_OUTBOX_TTL_SECS } from './marmotWelcomeOutbox';

const wrap = (id: string, recipient = 'c'.repeat(64)) =>
  ({
    id,
    kind: 1059,
    tags: [['p', recipient]],
    content: '',
    pubkey: '',
    created_at: 0,
    sig: '',
  }) as NostrEvent;

function makeNetwork() {
  let online = false;
  const published: string[] = [];
  return {
    published,
    setOnline: (v: boolean) => (online = v),
    network: {
      publish: async (relays: string[], e: NostrEvent) => {
        if (online) published.push(e.id);
        return Object.fromEntries(relays.map((r) => [r, { from: r, ok: online }]));
      },
    },
  };
}

describe('MarmotWelcomeOutbox', () => {
  it('captures refused gift wraps during an invite, reports progress, and keeps them for later', async () => {
    const net = makeNetwork();
    const outbox = new MarmotWelcomeOutbox(createMemoryMarmotBackend());
    const network = outbox.wrapNetwork(net.network);
    const ticks: number[] = [];
    const { failed } = await outbox.capture(
      async () => {
        await network.publish(['wss://a'], wrap('1'.repeat(64)));
        await network.publish(['wss://a'], { ...wrap('2'.repeat(64)), kind: 445 });
      },
      () => ticks.push(1),
    );
    expect(failed.map((w) => w.event.id)).toEqual(['1'.repeat(64)]);
    expect(failed[0]).toMatchObject({ relays: ['wss://a'], recipient: 'c'.repeat(64) });
    expect(ticks).toHaveLength(1); // only gift wraps count
    // Outside a capture nothing is collected.
    await network.publish(['wss://a'], wrap('3'.repeat(64)));

    expect(await outbox.resend(failed)).toHaveLength(1); // still offline
    await outbox.enqueue('group-a', failed);
    expect(await outbox.pending()).toHaveLength(1);
    net.setOnline(true);
    await outbox.flush();
    expect(net.published).toEqual(['1'.repeat(64)]);
    expect(await outbox.pending()).toHaveLength(0);
  });

  it('drops a group’s queue, expires old entries and stays bounded', async () => {
    const net = makeNetwork();
    const backend = createMemoryMarmotBackend();
    const outbox = new MarmotWelcomeOutbox(backend);
    outbox.wrapNetwork(net.network);
    const item = (id: string) => ({
      event: wrap(id),
      relays: ['wss://a'],
      recipient: 'c'.repeat(64),
    });
    await outbox.enqueue('group-a', [item('a'.repeat(64))]);
    await outbox.enqueue('group-b', [item('b'.repeat(64))]);
    await outbox.drop('group-a');
    expect((await outbox.pending()).map((p) => p.groupIdHex)).toEqual(['group-b']);

    // Expired: removed without being sent.
    const [stale] = await outbox.pending();
    stale.queuedAt -= WELCOME_OUTBOX_TTL_SECS + 1;
    await backend.set('welcomeOutbox', stale.event.id, JSON.stringify(stale));
    net.setOnline(true);
    await outbox.flush();
    expect(net.published).toEqual([]);
    expect(await outbox.pending()).toHaveLength(0);

    for (let i = 0; i < 105; i++) {
      await outbox.enqueue('group-c', [item(i.toString(16).padStart(64, '0'))]);
    }
    expect(await outbox.pending()).toHaveLength(100);
  });
});

describe('MarmotWelcomeOutbox concurrency', () => {
  it('runs invites one at a time so each keeps only its own refused wraps', async () => {
    const net = makeNetwork();
    const outbox = new MarmotWelcomeOutbox(createMemoryMarmotBackend());
    const network = outbox.wrapNetwork(net.network);
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const order: string[] = [];
    const a = outbox.capture(async () => {
      order.push('a:start');
      await gateA;
      await network.publish(['wss://a'], wrap('a'.repeat(64)));
      order.push('a:end');
    });
    const b = outbox.capture(async () => {
      order.push('b:start');
      await network.publish(['wss://a'], wrap('b'.repeat(64)));
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['a:start']); // b waits for a
    releaseA();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.failed.map((w) => w.event.id)).toEqual(['a'.repeat(64)]);
    expect(rb.failed.map((w) => w.event.id)).toEqual(['b'.repeat(64)]);
    // A failed invite doesn't block the next one.
    await expect(outbox.capture(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect((await outbox.capture(async () => 'ok')).result).toBe('ok');
  });
});
