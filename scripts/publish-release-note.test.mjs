import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AbstractRelay } from 'nostr-tools/abstract-relay';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { encrypt, decrypt, getConversationKey } from 'nostr-tools/nip44';
import {
  publishToRelays,
  normalizeRelayTargets,
  selectWriteRelays,
  signAndPublish,
  MAX_RELAYS,
} from './publish-release-note.mjs';

test('only positive relay OK counts; connection failure and rejection fail', async () => {
  const event = { content: 'Fake unsigned test content' };
  const pool = {
    async ensureRelay(url) {
      if (url === 'wss://offline.example/') throw new Error('Fake connection failure');
      return {
        async publish(received) {
          assert.equal(received, event);
          if (url === 'wss://reject.example/') throw new Error('Fake rejection');
        },
      };
    },
  };
  const results = await publishToRelays(
    pool,
    ['wss://ok.example', 'wss://offline.example', 'wss://reject.example'],
    event,
  );
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected', 'rejected'],
  );
});

test('publisher refuses local execution before reading inputs or contacting relays', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL('./publish-release-note.mjs', import.meta.url))],
        {
          env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'false' },
          stdio: 'pipe',
        },
      ),
    (error) => {
      assert.match(
        error.stderr.toString(),
        /Publishing is allowed only on a GitHub Actions runner/,
      );
      return true;
    },
  );
});

// Synthetic fixture keys only; no production credentials or network transports.
const accountKey = new Uint8Array(32).fill(1);
const accountPubkey = getPublicKey(accountKey);
const fixture = () => ({
  kind: 1,
  pubkey: accountPubkey,
  created_at: 123,
  tags: [['t', 'LightningPiggy']],
  content: 'Offline release',
});
const relayList = (tags, created_at = 1, id = 'a') => ({ tags, created_at, id });

function harness({ signed, signerPubkey = accountPubkey, tags, fail = [] } = {}) {
  const state = { closed: 0, destroyed: 0, queried: 0, published: [], calls: [] };
  const secret = new Uint8Array(32).fill(2);
  const unsigned = fixture();
  const signer = {
    async connect() {
      state.calls.push('connect');
    },
    async getPublicKey() {
      state.calls.push('pubkey');
      return signerPubkey;
    },
    async signEvent(event) {
      state.calls.push('sign');
      return signed ? signed(event) : finalizeEvent(event, accountKey);
    },
    async close() {
      state.closed++;
    },
  };
  const pool = {
    async querySync() {
      state.queried++;
      return [
        relayList(
          tags || [
            ['r', 'wss://one.example'],
            ['r', 'wss://two.example'],
          ],
        ),
      ];
    },
    async ensureRelay(url) {
      return {
        async publish(event) {
          state.published.push({ url, event });
          if (fail.includes(url)) throw new Error('Synthetic rejection');
        },
      };
    },
    destroy() {
      state.destroyed++;
    },
  };
  return {
    state,
    secret,
    unsigned,
    signer,
    pool,
    run() {
      return signAndPublish(unsigned, {
        signer,
        pool,
        secret,
        expectedPubkey: accountPubkey,
        log() {},
      });
    },
  };
}

function assertClean(h) {
  assert.equal(h.state.closed, 1);
  assert.equal(h.state.destroyed, 1);
  assert.ok(h.secret.every((byte) => byte === 0));
}

test('valid signed event publishes to two distinct relays and cleans up', async () => {
  const h = harness();
  assert.match(await h.run(), /^https:\/\/njump.me\/nevent1/);
  assert.deepEqual(h.state.calls, ['connect', 'pubkey', 'sign']);
  assert.equal(h.state.published.length, 2);
  assertClean(h);
});

for (const [field, value] of Object.entries({
  content: 'Altered content',
  kind: 2,
  created_at: 456,
  tags: [['t', 'altered']],
})) {
  test(`rejects a cryptographically valid event with altered ${field}`, async () => {
    const h = harness({
      signed: (event) => finalizeEvent({ ...event, [field]: value }, accountKey),
    });
    await assert.rejects(h.run(), /different or invalid release event/);
    assert.equal(h.state.queried, 0);
    assert.equal(h.state.published.length, 0);
    assertClean(h);
  });
}

for (const field of ['id', 'sig']) {
  test(`rejects invalid ${field} despite the library's cached verification symbol`, async () => {
    const h = harness({
      signed: (event) => {
        const result = finalizeEvent(event, accountKey);
        assert.ok(verifyEvent(result));
        result[field] = '0'.repeat(field === 'id' ? 64 : 128);
        assert.ok(verifyEvent(result)); // Cached true: production must recompute.
        return result;
      },
    });
    await assert.rejects(h.run(), /different or invalid release event/);
    assert.equal(h.state.queried, 0);
    assertClean(h);
  });
}

test('rejects both a wrong signer account and a wrong signed-event pubkey', async () => {
  const otherKey = new Uint8Array(32).fill(3);
  for (const options of [
    { signerPubkey: getPublicKey(otherKey) },
    { signed: (event) => finalizeEvent(event, otherKey) },
  ]) {
    const h = harness(options);
    await assert.rejects(h.run(), /wrong account|different or invalid release event/);
    assert.equal(h.state.queried, 0);
    assertClean(h);
  }
});

test('signer cannot mutate the requested fields in place', async () => {
  const h = harness({
    signed: (event) => {
      event.content = 'Mutated request';
      return finalizeEvent(event, accountKey);
    },
  });
  await assert.rejects(h.run(), /different or invalid release event/);
  assertClean(h);
});

test('approval timeout covers connect, account lookup and signing, and always cleans up', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const method of ['connect', 'getPublicKey', 'signEvent']) {
    const h = harness();
    h.signer[method] = () => new Promise(() => {});
    h.signer.close = async () => {
      h.state.closed++;
      throw new Error('Already closed');
    };
    const result = h.run();
    // Advance through immediately resolved stages before firing the deadline.
    await Promise.resolve();
    await Promise.resolve();
    const rejection = assert.rejects(result, /Amber approval timed out/);
    t.mock.timers.tick(600_000);
    await rejection;
    assert.equal(h.state.queried, 0);
    assertClean(h);
  }
});

test('filters relay schemes, credentials, query, hash, modes; selects latest and caps targets', () => {
  const tags = [
    ['r', 'ws://insecure.example'],
    ['r', 'https://http.example'],
    ['r', 'wss://user:pass@private.example'],
    ['r', 'wss://query.example?q=1'],
    ['r', 'wss://fragment.example/#fragment'],
    ['r', 'invalid'],
    ['r', 'wss://read.example', 'read'],
    ['r', 'wss://mode.example', 'unknown'],
    ['x', 'wss://other.example'],
    ['r', 'wss://WRITE.example:443/a//b/', 'write'],
    ['r', 'wss://write.example/a/b'],
    ['r', 'wss://both.example'],
  ];
  assert.deepEqual(
    selectWriteRelays([relayList([['r', 'wss://stale.example']], 1), relayList(tags, 2)]),
    ['wss://write.example/a/b', 'wss://both.example/'],
  );
  const many = Array.from({ length: 50 }, (_, i) => `wss://relay${i}.example`);
  assert.equal(normalizeRelayTargets(many).length, MAX_RELAYS);
  assert.equal(selectWriteRelays([relayList(many.map((url) => ['r', url]))]).length, MAX_RELAYS);
  assert.deepEqual(
    selectWriteRelays([relayList([['r', 'ws://invalid.example']])]),
    normalizeRelayTargets(['wss://relay.primal.net', 'wss://relay.damus.io', 'wss://nos.lol']),
  );
});

test('path aliases publish once through the real relay promise map and positive OK completes', async (t) => {
  const relay = new AbstractRelay('wss://relay.example/a/b', { verifyEvent });
  // Drive the actual library publish/OK machinery entirely in memory.
  relay.send = (message) => {
    const [, event] = JSON.parse(message);
    queueMicrotask(() => relay._onmessage({ data: JSON.stringify(['OK', event.id, true, '']) }));
  };
  const calls = [];
  const pool = {
    async ensureRelay(url) {
      calls.push(url);
      return relay;
    },
  };
  const event = finalizeEvent(fixture(), accountKey);
  t.after(() => relay.close());
  const results = await publishToRelays(
    pool,
    ['wss://relay.example/a//b', 'wss://relay.example/a/b'],
    event,
  );
  assert.deepEqual(calls, ['wss://relay.example/a/b']);
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled'],
  );
  assert.equal(relay.openEventPublishes.size, 0);
});

test('two-relay threshold counts distinct normalized URLs and positive OK only', async () => {
  for (const options of [
    {
      tags: [
        ['r', 'wss://one.example/a//b'],
        ['r', 'wss://one.example/a/b'],
      ],
    },
    { fail: ['wss://two.example/'] },
  ]) {
    const h = harness(options);
    await assert.rejects(h.run(), /Fewer than 2 relays accepted/);
    assertClean(h);
  }
});

test('real BunkerSigner connect sends the bunker secret in its encrypted handshake', async () => {
  const client = new Uint8Array(32).fill(4);
  const bunker = new Uint8Array(32).fill(5);
  const pubkey = getPublicKey(bunker);
  const pointer = await parseBunkerInput(
    `bunker://${pubkey}?relay=wss%3A%2F%2Fbunker.example&secret=offline-fixture`,
  );
  const conversationKey = getConversationKey(bunker, getPublicKey(client));
  let onevent;
  let request;
  let closed = false;
  const pool = {
    subscribe(_relays, _filter, handlers) {
      onevent = handlers.onevent;
      return {
        close() {
          closed = true;
        },
      };
    },
    publish(_relays, event) {
      assert.ok(verifyEvent(event));
      request = JSON.parse(decrypt(event.content, conversationKey));
      queueMicrotask(() =>
        onevent({
          content: encrypt(JSON.stringify({ id: request.id, result: 'ack' }), conversationKey),
        }),
      );
      return [Promise.resolve('OK')];
    },
  };
  const signer = BunkerSigner.fromBunker(client, pointer, { pool });
  try {
    await signer.connect();
    assert.equal(request.method, 'connect');
    assert.deepEqual(request.params, [pubkey, 'offline-fixture']);
  } finally {
    await signer.close();
    client.fill(0);
    bunker.fill(0);
  }
  assert.equal(closed, true);
});
