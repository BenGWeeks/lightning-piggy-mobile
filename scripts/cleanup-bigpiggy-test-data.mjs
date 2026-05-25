#!/usr/bin/env node
// One-off cleanup: retract BIG Piggy's leftover test geo-cache + test
// NIP-52 events from the relays. For each addressable target we publish:
//   1. an expired tombstone — an empty replaceable event at the same
//      (kind, d) with a past `expiration` (NIP-40), so even relays/clients
//      that ignore kind 5 see the newest version as expired + retracted;
//   2. a NIP-09 kind-5 deletion referencing the addressable coordinate.
// "Update expiry, then delete", per the cleanup request.
//
// Signs with the BIG Piggy fixture key (MAESTRO_NSEC_BIG). Run with:
//   node --env-file=.env scripts/cleanup-bigpiggy-test-data.mjs

import WebSocket from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import { resolvePiggy } from './_piggyFixtures.mjs';

const { sk, pk } = resolvePiggy('BIG');

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

// (kind, d) of each BIG Piggy test artifact to remove.
const TARGETS = [
  { kind: 37516, d: 'big-piggy-geo-cache-1' },
  { kind: 31923, d: 'bitcoin-park-nashville-meetup' },
  { kind: 31923, d: 'btc-prague-2026' },
  { kind: 31923, d: 'warsaw-bitcoin-film' },
];

const now = Math.floor(Date.now() / 1000);

function buildEvents({ kind, d }) {
  // Expired tombstone — newest version at (pk, kind, d) wins (NIP-01) and is
  // already past its NIP-40 expiration, so it stops surfacing.
  const tombstone = finalizeEvent(
    {
      kind,
      created_at: now,
      tags: [
        ['d', d],
        ['deleted', '1'],
        // Near-future expiry: relays reject an already-past expiration, so
        // set it ahead — the empty event supersedes the real one (NIP-01
        // replaceable-wins) on every relay now, and ages out via NIP-40.
        ['expiration', String(now + 86400)],
      ],
      content: '',
    },
    sk,
  );
  // NIP-09 deletion at the addressable coordinate (retracts every version).
  const deletion = finalizeEvent(
    {
      kind: 5,
      created_at: now + 1,
      tags: [
        ['a', `${kind}:${pk}:${d}`],
        ['k', String(kind)],
      ],
      content: 'Removing stale Lightning Piggy test data',
    },
    sk,
  );
  return [tombstone, deletion];
}

async function publish(url, evt) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve({ url, ok: false, note: 'timeout' });
    }, 6000);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', evt])));
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg[0] === 'OK' && msg[1] === evt.id) {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
        resolve({ url, ok: msg[2], note: msg[3] ?? '' });
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      resolve({ url, ok: false, note: `error: ${err.message}` });
    });
  });
}

console.log(`Author (BIG Piggy): ${pk}`);
for (const target of TARGETS) {
  console.log(`\n=== ${target.kind}:${target.d} ===`);
  for (const evt of buildEvents(target)) {
    const label = evt.kind === 5 ? 'deletion (kind 5)' : `expired tombstone (kind ${evt.kind})`;
    const results = await Promise.all(RELAYS.map((url) => publish(url, evt)));
    const okCount = results.filter((r) => r.ok).length;
    console.log(`  ${label}: ${okCount}/${RELAYS.length} relays accepted`);
  }
}
console.log('\nDone.');
