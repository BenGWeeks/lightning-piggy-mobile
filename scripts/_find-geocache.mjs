import { SimplePool } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { nip19 } from 'nostr-tools';
import WebSocket from 'ws';
// eslint-disable-next-line react-hooks/rules-of-hooks
useWebSocketImplementation(WebSocket);

const relays = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://purplepag.es',
];

const pool = new SimplePool();
// Query kind 37516 events broadly — we'll filter client-side by name match.
console.log(`querying ${relays.length} relays for kind 37516 events…`);
const evs = await pool.querySync(relays, { kinds: [37516], limit: 500 });
console.log(`got ${evs.length} events total`);

// Filter for ones whose name tag (or content) mentions "Geo-Cache 1" (or "geo-cache 1" / "geocache 1").
const re = /geo[- ]?cache\s*1\b/i;
const matches = [];
for (const ev of evs) {
  const nameTag = ev.tags.find((t) => t[0] === 'name')?.[1] ?? '';
  const dTag = ev.tags.find((t) => t[0] === 'd')?.[1] ?? '';
  const content = ev.content ?? '';
  if (re.test(nameTag) || re.test(dTag) || re.test(content)) {
    matches.push({
      id: ev.id,
      pubkey: ev.pubkey,
      name: nameTag,
      d: dTag,
      created_at: ev.created_at,
    });
  }
}
console.log(`\n${matches.length} matches:`);
for (const m of matches) {
  const npub = nip19.npubEncode(m.pubkey);
  const when = new Date(m.created_at * 1000).toISOString();
  console.log(`  ${m.pubkey}`);
  console.log(`    npub:    ${npub}`);
  console.log(`    name:    "${m.name}"`);
  console.log(`    d-tag:   "${m.d}"`);
  console.log(`    created: ${when}`);
  console.log(`    event:   ${m.id.slice(0, 16)}…`);
  console.log();
}
pool.close(relays);
