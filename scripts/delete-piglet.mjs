#!/usr/bin/env node
// Issue a NIP-09 (kind 5) deletion event for a kind 37516 Piglet
// listing, signed by the listing's author. Also publishes an empty
// replacement event at the same `d` address so any relay that ignores
// kind 5 still sees the listing as effectively retracted (NIP-01
// replaceable: newest per (author, kind, d) wins).
//
// The nsec is read from the env var PIGGY_NSEC — never pass keys on the
// command line. The author of the targeted event must match the nsec.
//
// Usage:
//   PIGGY_NSEC=nsec1… node scripts/delete-piglet.mjs <eventId> <dTag>
//
// Example:
//   PIGGY_NSEC=nsec1… node scripts/delete-piglet.mjs \
//     39aee785fd4d4733fbb914c8d2c425e297ced101dffc044786a3b52d51bcb195 \
//     big-piggy-geo-cache-1

import WebSocket from 'ws';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';

const [, , eventId, dTag] = process.argv;
const nsec = process.env.PIGGY_NSEC;
if (!nsec || !eventId || !dTag) {
  console.error('Usage: PIGGY_NSEC=nsec1… node scripts/delete-piglet.mjs <eventId> <dTag>');
  process.exit(2);
}
if (!/^[0-9a-f]{64}$/.test(eventId)) {
  console.error('eventId must be 64-char hex');
  process.exit(2);
}

const decoded = nip19.decode(nsec);
if (decoded.type !== 'nsec') {
  console.error('PIGGY_NSEC must be a valid nsec1…');
  process.exit(2);
}
const sk = decoded.data;
const pk = getPublicKey(sk);

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const now = Math.floor(Date.now() / 1000);

// Kind 5 deletion request (NIP-09). For parameterized-replaceable
// events (NIP-33 / kind 30000-39999, which includes 37516), the spec
// asks for an `a` tag at the addressable coord — that retracts every
// version of the listing, not just one event id. We include `e` too
// for relays that only honour event-id deletions.
const deletion = finalizeEvent(
  {
    kind: 5,
    created_at: now,
    tags: [
      ['a', `37516:${pk}:${dTag}`],
      ['e', eventId],
      ['k', '37516'],
    ],
    content: 'Removing stale test Piglet listing',
  },
  sk,
);

// Empty replacement at the same d-tag. Some relays don't honour kind 5,
// but every NIP-01 relay honours replaceable-event semantics — a newer
// event with the same (author, kind, d) wins. We leave the LP NIP-32
// label off so the app's discovery filter doesn't even surface it.
const tombstone = finalizeEvent(
  {
    kind: 37516,
    created_at: now + 1,
    tags: [
      ['d', dTag],
      ['deleted', '1'],
    ],
    content: '',
  },
  sk,
);

async function publish(url, evt) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve({ url, ok: false, note: 'timeout' });
    }, 5000);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', evt])));
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg[0] === 'OK' && msg[1] === evt.id) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve({ url, ok: msg[2], note: msg[3] ?? '' });
      } else if (msg[0] === 'NOTICE') {
        console.error(`NOTICE from ${url}: ${JSON.stringify(msg[1])}`);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      resolve({ url, ok: false, note: `error: ${err.message}` });
    });
  });
}

console.log(`Author pubkey: ${pk}`);
console.log(`Deletion id:   ${deletion.id}`);
console.log(`Tombstone id:  ${tombstone.id}`);

for (const evt of [deletion, tombstone]) {
  console.log(`\nPublishing kind ${evt.kind}…`);
  const results = await Promise.all(RELAYS.map((url) => publish(url, evt)));
  for (const r of results) {
    console.log(`  ${r.url.padEnd(28)} → ${r.ok ? 'ok' : 'fail'} ${r.note}`);
  }
}
