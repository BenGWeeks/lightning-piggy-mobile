// Publishes a NIP-52 kind 31923 ("time-based calendar event") near
// Cambridge, UK so the Explore Events feed / hub rail has something
// to render for demo screenshots. Real Bitcoin meetups in the UK
// don't yet publish to Nostr (they live on Meetup.com / lu.ma); this
// fixture demonstrates the rendering once they do.
//
//   node scripts/publish-test-event.mjs
//
// Override via env vars: NSEC (else disposable key), TITLE, IMAGE,
// LAT, LON, START_OFFSET_SECONDS, DURATION_SECONDS, LOCATION.
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';

// eslint-disable-next-line react-hooks/rules-of-hooks
useWebSocketImplementation(WebSocket);

const TITLE = process.env.TITLE ?? 'Cambridge Bitcoin Drinks';
const DESCRIPTION =
  process.env.DESCRIPTION ??
  'Casual monthly Bitcoin meetup at The Bitcoin Embassy pub. Bring your Lightning wallet — we run a circular-payments game.';
const LOCATION = process.env.LOCATION ?? 'The Bitcoin Embassy, Cambridge, UK';
// Cambridge city centre by default — sits within u12 (3-char) so a
// user located anywhere in East Anglia picks it up via the 150 km
// `subscribeNearbyEvents` widening.
const LAT = parseFloat(process.env.LAT ?? '52.2053');
const LON = parseFloat(process.env.LON ?? '0.1218');
const START_OFFSET_SECONDS = parseInt(process.env.START_OFFSET_SECONDS ?? `${7 * 24 * 60 * 60}`, 10);
const DURATION_SECONDS = parseInt(process.env.DURATION_SECONDS ?? `${3 * 60 * 60}`, 10);
const IMAGE =
  process.env.IMAGE ??
  'https://github.com/BenGWeeks/lightning-piggy-mobile/raw/feat/explore-tab/docs/test-fixtures/cambridge-bitcoin-meetup.jpg';

const ALPHA = '0123456789bcdefghjkmnpqrstuvwxyz';
function gh(lat, lon, p = 9) {
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

const g9 = gh(LAT, LON, 9);
const start = Math.floor(Date.now() / 1000) + START_OFFSET_SECONDS;
const end = start + DURATION_SECONDS;

const nsecInput = process.env.NSEC;
let sk;
if (nsecInput) {
  const decoded = nip19.decode(nsecInput.trim());
  if (decoded.type !== 'nsec') throw new Error(`Expected nsec1…, got "${decoded.type}"`);
  sk = decoded.data;
  console.log('Signing with provided nsec — event will be replaceable by this npub.');
} else {
  sk = generateSecretKey();
  console.log('No NSEC env var → using disposable key.');
}
const pk = getPublicKey(sk);
const npub = nip19.npubEncode(pk);

const tags = [
  ['d', `cambridge-bitcoin-drinks-${start}`],
  ['title', TITLE],
  // Multi-precision g tags 3..9 — matches the NIP-GC publisher's
  // pattern. Precision 3 ("u12") catches readers anywhere in East
  // Anglia under the hub's broader event prefix.
  ...Array.from({ length: 7 }, (_, i) => ['g', g9.slice(0, i + 3)]),
  ['start', String(start)],
  ['end', String(end)],
  ['location', LOCATION],
  ['image', IMAGE],
  ['t', 'bitcoin'],
  ['t', 'meetup'],
  ['expiration', String(end + 24 * 60 * 60)],
];

const evt = finalizeEvent(
  { kind: 31923, created_at: Math.floor(Date.now() / 1000), tags, content: DESCRIPTION },
  sk,
);

console.log('--- event preview ---');
console.log(JSON.stringify(evt, null, 2));
console.log('--- pubkey ---');
console.log('npub:', npub);

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

await new Promise((r) => setTimeout(r, 1500));
const fetched = await pool.querySync(RELAYS, {
  kinds: [31923],
  '#g': [g9.slice(0, 3)],
  authors: [pk],
});
console.log(`\n--- re-fetch by g=${g9.slice(0, 3)} authors=[ours] → ${fetched.length} event(s)`);

await pool.close(RELAYS);
process.exit(0);
