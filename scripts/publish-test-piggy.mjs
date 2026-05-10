// Publishes a kind-30408 "Hidden Piggy" event to LP's default relays, signed
// by a fresh disposable key. Used for end-to-end testing of the M6 publish/
// subscribe shape before the in-app composer lands.
//
//   node scripts/publish-test-piggy.mjs
//
// Override values via env vars: LAT, LON, MEMO, PIGGY_ID, LNURL.
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';

// nostr-tools' API uses a `use*` name but it's a one-shot module-level
// registration, not a React hook — eslint heuristic needs the suppression.
// eslint-disable-next-line react-hooks/rules-of-hooks
useWebSocketImplementation(WebSocket);

// --- Defaults: Big Piggy's Geo-Cache 1 (Longstanton, Cambridge) -------------
const LAT = parseFloat(process.env.LAT ?? '52.283602');
const LON = parseFloat(process.env.LON ?? '0.043889');
const LNURL =
  process.env.LNURL ??
  'lightning:LNURL1DP68GURN8GHJ7CNPDE4JUAM9V44HXENPD45KC7FWD4JJ7AMFW35XGUNPWUHKZURF9AMRZTMVDE6HYMP0GGE8ZMNDDGU5SSTEGYE9GMJ9WA38V7PJDEVZ73M32DK4XCTT2FHKS7T9DE2HQSJW8PG4J6RE7CXWSZ';
const MEMO =
  process.env.MEMO ??
  '🐷 Geo-Cache 1 — Longstanton, Cambridge. 21 sats per claim, 3h cooldown, 100 uses.';
const PIGGY_ID = process.env.PIGGY_ID ?? 'big-piggy-geo-cache-1';

// geohash encoder (same as utils/geohash.ts in the repo)
const ALPHA = '0123456789bcdefghjkmnpqrstuvwxyz';
function gh(lat, lon, p = 7) {
  let lo = -90,
    hi = 90,
    Lo = -180,
    Hi = 180,
    bit = 0,
    ch = 0,
    even = true,
    out = '';
  while (out.length < p) {
    if (even) {
      const m = (Lo + Hi) / 2;
      if (lon >= m) {
        ch |= 1 << (4 - bit);
        Lo = m;
      } else Hi = m;
    } else {
      const m = (lo + hi) / 2;
      if (lat >= m) {
        ch |= 1 << (4 - bit);
        lo = m;
      } else hi = m;
    }
    even = !even;
    if (bit < 4) {
      bit++;
    } else {
      out += ALPHA[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}
const g7 = gh(LAT, LON, 7);

// Signing key — pass `BIG_PIGGY_NSEC=nsec1...` (or NSEC=nsec1...) to publish
// from a real identity (events become replaceable by that pubkey later).
// Falls back to a fresh disposable key, useful for one-shot test events
// that nobody can edit afterwards.
const nsecInput = process.env.BIG_PIGGY_NSEC ?? process.env.NSEC;
let sk;
if (nsecInput) {
  const decoded = nip19.decode(nsecInput.trim());
  if (decoded.type !== 'nsec') {
    throw new Error(`Expected nsec1… in BIG_PIGGY_NSEC, got "${decoded.type}"`);
  }
  sk = decoded.data;
  console.log('Signing with provided nsec — event will be replaceable by this npub.');
} else {
  sk = generateSecretKey();
  console.log('No NSEC env var → using disposable key (event will be unreplaceable).');
}
const pk = getPublicKey(sk);
const npub = nip19.npubEncode(pk);

const tags = [
  ['d', PIGGY_ID],
  ['g', g7],
  ['g', g7.slice(0, 6)],
  ['g', g7.slice(0, 5)],
  ['g', g7.slice(0, 4)],
  ['lnurl', LNURL],
  ['wait', '10800'], // 3 hours, mirrors LNbits wait_time
  ['uses', '100'],
  ['expiration', String(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60)], // 30d
  ['t', 'piggy'],
  ['t', 'lightningpiggy'],
];

const evt = finalizeEvent(
  {
    kind: 30408,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: MEMO,
  },
  sk,
);

console.log('--- event preview ---');
console.log(JSON.stringify(evt, null, 2));
console.log('--- pubkey ---');
console.log('hex :', pk);
console.log('npub:', npub);
console.log('--- event id ---');
console.log(evt.id);

// Publish to LP's default relays + a couple of broadly-indexed ones
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const pool = new SimplePool();
const results = await Promise.allSettled(pool.publish(RELAYS, evt));

console.log('\n--- publish results ---');
RELAYS.forEach((r, i) => {
  const res = results[i];
  console.log(`${r}: ${res.status}${res.status === 'rejected' ? ' — ' + res.reason : ''}`);
});

// Wait then re-fetch to confirm it lands
await new Promise((r) => setTimeout(r, 1500));
console.log('\n--- re-fetch (subscribe with #g) ---');
const fetched = await pool.querySync(RELAYS, { kinds: [30408], '#g': [g7], authors: [pk] });
console.log(`got back ${fetched.length} event(s) matching #g=${g7} authors=[ours]`);
fetched.forEach((e) => console.log('  id:', e.id, 'kind:', e.kind, 'tags:', e.tags.length));

await pool.close(RELAYS);
process.exit(0);
