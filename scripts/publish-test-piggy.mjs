// Publishes a NIP-GC kind 37516 "geocache listing" event with the
// Lightning Piggy `lnurl` extension, signed by a fresh disposable key
// (or `BIG_PIGGY_NSEC` env var). Used for end-to-end testing of the
// M6 publish / subscribe shape before the in-app composer lands.
//
// We adopt treasures.to's NIP-GC draft (kind 37516 listings, kind 7516
// found-logs, kind 1111 comments per NIP-22) and add `lnurl`/`wait`/
// `uses` extension tags for our Lightning-payout flavour. Their
// existing schema's `D/T/S/t` defaults are smart for an NFC-tag Piggy:
// difficulty 1, terrain 1, size micro, type traditional. See project
// memory `treasures.to interop`.
//
//   node scripts/publish-test-piggy.mjs
//
// Override values via env vars: LAT, LON, NAME, MEMO, HINT, PIGGY_ID,
// DIFFICULTY, TERRAIN, SIZE, CACHE_TYPE.
//
// Note: there is NO `LNURL` env var. The LNURL is intentionally NOT
// part of this script's output — see the schema comment below for
// why. The LNURL belongs on the physical NFC tag / QR sticker the
// hider stashes, not on a relay-broadcast event.
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
const NAME = process.env.NAME ?? 'Geo-Cache 1';
const MEMO =
  process.env.MEMO ??
  '🐷 Geo-Cache 1 — Longstanton, Cambridge. 21 sats per claim, 3h cooldown, 100 uses.';
const HINT = process.env.HINT ?? 'Look near the bench by the village sign.';
const PIGGY_ID = process.env.PIGGY_ID ?? 'big-piggy-geo-cache-1';
const DIFFICULTY = process.env.DIFFICULTY ?? '1';
const TERRAIN = process.env.TERRAIN ?? '1';
const SIZE = process.env.SIZE ?? 'micro';
const CACHE_TYPE = process.env.CACHE_TYPE ?? 'traditional';

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
// ROT13 for the hint per NIP-GC client guidance — prevents inline
// spoilers when generic Nostr clients render the listing.
const rot13 = (s) =>
  s.replace(/[A-Za-z]/g, (c) => {
    const b = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b);
  });

// Multi-precision g tags per the NIP-GC suggestion (3-9 chars).
const g9 = gh(LAT, LON, 9);

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

// NIP-GC kind 37516 listing — required (d, name, g, D, T, S) + optional
// (t, hint, image, r, verification) + LP's marker label.
//
// CRITICAL: We deliberately do NOT include the LNURL string in the
// event. Public Nostr events are broadcast to every relay subscriber;
// embedding the bearer-token LNURL would let anyone in the world
// drain the cache without ever physically visiting it. The LNURL
// belongs on the physical artifact only (NFC tag + printed QR);
// the event carries metadata + a marker label so clients can render
// the LP claim UX while pointing the finder at the physical tag.
//
// We mark Lightning-payout caches via a NIP-32 label: ["L", "lp.piggy"]
// (namespace) + ["l", "payout-lnurl-w", "lp.piggy"] (label value within
// the namespace). Generic geocaching clients (treasures.to) render the
// cache as a standard NIP-GC listing; LP recognises the label and
// shows the 🐷 pin / "tap the physical tag to claim" UX without
// leaking the bearer token to relays.
const tags = [
  ['d', PIGGY_ID],
  ['name', NAME],
  // g tags at every precision from 3 to 9 — cheap on event size,
  // dramatically widens the prefix-filter surface for proximity queries.
  ...Array.from({ length: 7 }, (_, i) => ['g', g9.slice(0, i + 3)]),
  ['D', DIFFICULTY],
  ['T', TERRAIN],
  ['S', SIZE],
  ['t', CACHE_TYPE],
  ['hint', rot13(HINT)],
  // --- Lightning Piggy marker (NIP-32 label, not a bearer token!) ---
  ['L', 'lp.piggy'], // label namespace
  ['l', 'payout-lnurl-w', 'lp.piggy'], // payout type within the namespace
  ['expiration', String(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60)], // 30d
];

const evt = finalizeEvent(
  {
    kind: 37516,
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
const fetched = await pool.querySync(RELAYS, {
  kinds: [37516],
  '#g': [g9.slice(0, 7)],
  authors: [pk],
});
console.log(
  `got back ${fetched.length} event(s) matching kind=37516 #g=${g9.slice(0, 7)} authors=[ours]`,
);
fetched.forEach((e) => console.log('  id:', e.id, 'kind:', e.kind, 'tags:', e.tags.length));

await pool.close(RELAYS);
process.exit(0);
