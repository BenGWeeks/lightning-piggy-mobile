#!/usr/bin/env node
// List every kind 37516 (NIP-GC cache listing) event that carries the
// Lightning Piggy NIP-32 label `com.lightningpiggy.app`, across the
// app's DEFAULT_RELAYS. Filter is by `#L` (label namespace), so we catch
// every Piggy ever published from this app regardless of author —
// covering the main user pubkey and any Maestro fixture pubkeys.
//
// Read-only — prints, does not delete. Use to identify stale test caches
// before issuing NIP-09 (kind 5) deletion events.
//
// Optional second arg narrows to a specific author hex pubkey.
//
// Usage:
//   node scripts/list-piglets-on-relays.mjs                  # all LP caches
//   node scripts/list-piglets-on-relays.mjs <hexAuthor>      # one author

import WebSocket from 'ws';

const authorFilter = process.argv[2];
if (authorFilter && !/^[0-9a-f]{64}$/.test(authorFilter)) {
  console.error('Optional author arg must be 64-char hex pubkey');
  process.exit(2);
}

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

// `#L` filter matches any event whose tags contain ["L", "com.lightningpiggy.app"]
// — that's how the app stamps every Piggy listing (see LP_LABEL_NAMESPACE in
// nostrPlacesService.ts).
const FILTER = {
  kinds: [37516],
  '#L': ['com.lightningpiggy.app'],
  limit: 500,
  ...(authorFilter ? { authors: [authorFilter] } : {}),
};
const SUB_ID = 'piglet-audit';

const events = new Map(); // id → { evt, relays:Set }

async function queryRelay(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const seen = new Set();
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve({ url, count: seen.size, note: 'timeout' });
    }, 6000);

    ws.on('open', () => {
      ws.send(JSON.stringify(['REQ', SUB_ID, FILTER]));
    });
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg[0] === 'EVENT' && msg[1] === SUB_ID) {
        const evt = msg[2];
        seen.add(evt.id);
        const existing = events.get(evt.id);
        if (existing) existing.relays.add(url);
        else events.set(evt.id, { evt, relays: new Set([url]) });
      } else if (msg[0] === 'EOSE' && msg[1] === SUB_ID) {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
        resolve({ url, count: seen.size, note: 'eose' });
      } else if (msg[0] === 'NOTICE') {
        console.error(`NOTICE from ${url}: ${JSON.stringify(msg[1])}`);
      } else if (msg[0] === 'CLOSED' && msg[1] === SUB_ID) {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
        resolve({ url, count: seen.size, note: `closed: ${msg[2] ?? ''}` });
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      resolve({ url, count: 0, note: `error: ${err.message}` });
    });
  });
}

const results = await Promise.all(RELAYS.map(queryRelay));
console.log('\n=== per-relay summary ===');
for (const r of results) console.log(`  ${r.url.padEnd(28)} → ${r.count} events (${r.note})`);

// Group by (author, d-tag) since 37516 is replaceable per-author.
const byAddr = new Map();
for (const { evt, relays } of events.values()) {
  const d = evt.tags.find((t) => t[0] === 'd')?.[1] ?? '(no-d)';
  const key = `${evt.pubkey}:${d}`;
  const prev = byAddr.get(key);
  if (!prev || evt.created_at > prev.evt.created_at) byAddr.set(key, { evt, relays });
}

console.log(`\n=== ${byAddr.size} distinct (author, d) listings ===\n`);
const rows = Array.from(byAddr.values()).sort((a, b) => b.evt.created_at - a.evt.created_at);
const byAuthor = new Map();
for (const { evt, relays } of rows) {
  const d = evt.tags.find((t) => t[0] === 'd')?.[1] ?? '(no-d)';
  const name = evt.tags.find((t) => t[0] === 'name')?.[1] ?? '';
  const g = evt.tags.find((t) => t[0] === 'g')?.[1] ?? '';
  const when = new Date(evt.created_at * 1000).toISOString();
  console.log(`${when}  author=${evt.pubkey.slice(0, 16)}…  d=${d}`);
  console.log(`  name=${JSON.stringify(name)}  g=${g}`);
  console.log(`  id=${evt.id}`);
  console.log(
    `  on=${Array.from(relays)
      .map((r) => r.replace('wss://', ''))
      .join(',')}`,
  );
  console.log(`  content=${JSON.stringify(evt.content).slice(0, 140)}`);
  console.log('');
  byAuthor.set(evt.pubkey, (byAuthor.get(evt.pubkey) ?? 0) + 1);
}

console.log('=== authors ===');
for (const [pk, n] of byAuthor) console.log(`  ${pk}  ${n} listings`);
