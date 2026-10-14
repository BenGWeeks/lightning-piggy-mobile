import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import { generateSecretKey, getPublicKey, nip19, nip44 } from 'nostr-tools';
import { BunkerSigner, createNostrConnectURI } from 'nostr-tools/nip46';
import { SimplePool } from 'nostr-tools/pool';

// Exercise the actual daemon and nostr-tools signer against a loopback relay.
test(
  'locked bunker pairs and serves signing/decryption only on the test relay',
  { timeout: 15000 },
  async (t) => {
    const state = mkdtempSync(join(tmpdir(), 'nip46-lockdown-test-'));
    t.after(() => rmSync(state, { recursive: true, force: true }));
    const relay = new WebSocket.Server({ port: 0, host: '127.0.0.1' });
    await once(relay, 'listening');
    t.after(() => {
      for (const socket of relay.clients) socket.terminate();
      relay.close();
    });
    const relayUrl = `ws://127.0.0.1:${relay.address().port}`;
    const subscriptions = new Map();
    relay.on('connection', (socket) => {
      subscriptions.set(socket, new Map());
      socket.on('close', () => subscriptions.delete(socket));
      socket.on('message', (raw) => {
        const [type, id, eventOrFilter] = JSON.parse(String(raw));
        if (type === 'REQ') {
          subscriptions.get(socket).set(id, eventOrFilter);
          socket.send(JSON.stringify(['EOSE', id]));
        } else if (type === 'CLOSE') {
          subscriptions.get(socket).delete(id);
        } else if (type === 'EVENT') {
          const event = id;
          socket.send(JSON.stringify(['OK', event.id, true, 'saved']));
          for (const [peer, subs] of subscriptions) {
            for (const [subId, filter] of subs) {
              if (
                filter.kinds.includes(event.kind) &&
                event.tags.some(([tag, pk]) => tag === 'p' && filter['#p'].includes(pk))
              ) {
                peer.send(JSON.stringify(['EVENT', subId, event]));
              }
            }
          }
        }
      });
    });
    const portProbe = createServer();
    portProbe.listen(0, '127.0.0.1');
    await once(portProbe, 'listening');
    const port = portProbe.address().port;
    await new Promise((resolve) => portProbe.close(resolve));
    const bunkerKey = generateSecretKey();
    // Restored public destinations must also be overridden during startup.
    writeFileSync(
      join(state, `clients-${getPublicKey(bunkerKey).slice(0, 8)}.json`),
      JSON.stringify({ oldclient: ['wss://public.example'] }),
    );
    const bunker = spawn(process.execPath, ['scripts/nip46-test-bunker.mjs'], {
      env: {
        ...process.env,
        NIP46_STATE_DIR: state,
        NIP46_PORT: String(port),
        NIP46_RELAYS: 'wss://public.example',
        EXPO_PUBLIC_TEST_RELAY_URL: relayUrl,
        EXPO_PUBLIC_TEST_RELAY_LOCKDOWN: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    t.after(async () => {
      if (bunker.exitCode === null) {
        bunker.kill();
        await once(bunker, 'exit');
      }
    });
    bunker.stdin.end(nip19.nsecEncode(bunkerKey) + '\n');
    await new Promise((resolve, reject) => {
      let output = '';
      bunker.stdout.on('data', (chunk) => {
        output += String(chunk);
        if (output.includes('READY')) resolve();
      });
      bunker.on('exit', (code) => reject(new Error(`bunker exited early (${code})`)));
    });
    const headers = {
      Authorization: `Bearer ${readFileSync(join(state, 'token'), 'utf8').trim()}`,
    };
    const api = (path, body) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        headers,
        ...(body ? { method: 'POST', body } : {}),
      });
    const status = await (await api('/status')).json();
    assert.deepEqual(status.relays, [relayUrl]);
    const clientKey = generateSecretKey();
    const input = {
      clientPubkey: getPublicKey(clientKey),
      relays: [relayUrl],
      secret: 'test-secret',
      perms: ['sign_event', 'nip44_decrypt'],
    };
    const rejected = await api(
      '/pair',
      createNostrConnectURI({ ...input, relays: ['wss://relay.primal.net'] }),
    );
    assert.equal(rejected.status, 500);
    assert.match((await rejected.json()).error, /allowlist/);
    const pool = new SimplePool();
    t.after(() => pool.destroy());
    const uri = createNostrConnectURI(input);
    const pairing = BunkerSigner.fromURI(clientKey, uri, { pool }, 5000);
    // Wait for the client REQ before sending the non-replayed acknowledgement.
    while (
      ![...subscriptions.values()].some((subs) =>
        [...subs.values()].some((filter) => filter['#p'].includes(input.clientPubkey)),
      )
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((await api('/pair', uri)).status, 200);
    const signer = await pairing;
    t.after(() => signer.close().catch(() => {}));
    assert.equal(await signer.getPublicKey(), getPublicKey(bunkerKey));
    const signed = await signer.signEvent({ kind: 1, created_at: 123, tags: [], content: 'test' });
    assert.equal(signed.pubkey, getPublicKey(bunkerKey));
    const peerKey = generateSecretKey();
    const cipher = nip44.encrypt(
      'secret',
      nip44.getConversationKey(peerKey, getPublicKey(bunkerKey)),
    );
    assert.equal(await signer.nip44Decrypt(getPublicKey(peerKey), cipher), 'secret');
    assert.deepEqual((await (await api('/status')).json()).relays, [relayUrl]);
  },
);
