#!/usr/bin/env node
// Read-only audit of NIP-GC kind 37516 cache listings on the default
// relays, reporting each cache's geohash precision so we can size the
// "what counts as nearby" / "should we show a direction arrow" rules
// in the cache-detail UI sensibly.
//
// Usage:
//   node scripts/cache-precision-audit.mjs            # all caches, no bbox
//   node scripts/cache-precision-audit.mjs u12       # filter by geohash prefix

import WebSocket from 'ws';

const prefix = process.argv[2];

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

// Build the REQ filter. If a geohash prefix is given, narrow by `#g`
// (a NIP-32 indexed tag — relays that don't index it will return more
// events than asked and we filter locally below).
const FILTER = {
  kinds: [37516],
  limit: 500,
  ...(prefix ? { '#g': [prefix] } : {}),
};
const SUB_ID = 'cache-precision';

const events = new Map(); // id → evt

async function queryRelay(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve({ url, count: events.size, note: 'timeout' });
    }, 6000);
    ws.on('open', () => ws.send(JSON.stringify(['REQ', SUB_ID, FILTER])));
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg[0] === 'EVENT' && msg[1] === SUB_ID) {
        events.set(msg[2].id, msg[2]);
      } else if (msg[0] === 'EOSE' && msg[1] === SUB_ID) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve({ url, count: events.size, note: 'eose' });
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      resolve({ url, count: 0, note: `error: ${err.message}` });
    });
  });
}

// Approximate UTF-8 metre dimensions of a geohash cell at mid-latitudes
// (varies by latitude; these are at ~45°N which is fine for "is this
// rough or precise" framing). Even-length cells are square-ish; odd-
// length cells are 2:1 because the bit ordering alternates.
const PRECISION_M = {
  1: '5000 km',
  2: '1250 km',
  3: '156 km',
  4: '39 km',
  5: '4.9 km',
  6: '1.2 km',
  7: '153 m × 76 m',
  8: '38 m × 19 m',
  9: '4.8 m × 4.8 m',
  10: '1.2 m × 0.6 m',
  11: '15 cm',
};

const results = await Promise.all(RELAYS.map(queryRelay));
console.log('\n=== per-relay summary ===');
for (const r of results) console.log(`  ${r.url.padEnd(28)} → ${r.count} events (${r.note})`);

// Group by (author, d) since 37516 is replaceable
const byAddr = new Map();
for (const evt of events.values()) {
  const d = evt.tags.find((t) => t[0] === 'd')?.[1] ?? '(no-d)';
  const key = `${evt.pubkey}:${d}`;
  const prev = byAddr.get(key);
  if (!prev || evt.created_at > prev.created_at) byAddr.set(key, evt);
}

// Optional local-filter by prefix (catches relays that ignored #g).
const rows = Array.from(byAddr.values()).filter((evt) => {
  if (!prefix) return true;
  const g = evt.tags.find((t) => t[0] === 'g')?.[1] ?? '';
  return g.toLowerCase().startsWith(prefix.toLowerCase());
});

console.log(`\n=== ${rows.length} distinct listings${prefix ? ` matching prefix "${prefix}"` : ''} ===\n`);

// NIP-GC convention: caches publish MULTIPLE `g` tags at different
// precisions (typically 3, 5, 7, 9 chars) so relays can index by
// prefix. The actual cache location precision is the *longest* tag.
const hist = new Map();
for (const evt of rows) {
  const allG = evt.tags.filter((t) => t[0] === 'g').map((t) => t[1] ?? '');
  const longestG = allG.reduce((a, b) => (b.length > a.length ? b : a), '');
  hist.set(longestG.length, (hist.get(longestG.length) ?? 0) + 1);
  const name = evt.tags.find((t) => t[0] === 'name')?.[1] ?? '';
  const L = evt.tags.find((t) => t[0] === 'L')?.[1] ?? '(no-L)';
  console.log(
    `  longest g="${longestG}" (${longestG.length} chars ≈ ${PRECISION_M[longestG.length] ?? '?'})  all=[${allG.length}]  L=${L}  name=${JSON.stringify(name).slice(0, 50)}`,
  );
}

console.log('\n=== precision histogram ===');
const sorted = Array.from(hist.entries()).sort((a, b) => a[0] - b[0]);
for (const [len, n] of sorted) {
  console.log(`  ${len.toString().padStart(2)} chars  (${PRECISION_M[len] ?? '?'})  → ${n}`);
}
