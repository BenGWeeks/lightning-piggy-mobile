// Seeds a handful of NIP-52 kind 31923 events from Big Piggy so the
// Events sub-screen has realistic-looking content for screenshots
// and demo videos. Each event:
//   - Signs with $NSEC (defaults to $MAESTRO_NSEC_BIG) so the WoT
//     filter passes
//   - Has multi-precision g tags so geohash-prefix subs catch it
//   - Carries an `image` tag pointing at a flyer in `docs/test-fixtures/`
//   - Has start times spread across the next 4 weeks so the Events
//     screen's "UP NEXT" highlight + chronological ordering both
//     have material to work with
//
//   NSEC=nsec1... node scripts/publish-test-event-batch.mjs
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';

// eslint-disable-next-line react-hooks/rules-of-hooks
useWebSocketImplementation(WebSocket);

const REPO_RAW = 'https://github.com/BenGWeeks/lightning-piggy-mobile/raw/feat/explore-tab';
const FIXTURES = [
  {
    d: 'cambridge-bitcoin-drinks',
    title: 'Cambridge Bitcoin Drinks',
    description:
      'Casual monthly Bitcoin meetup at The Bitcoin Embassy pub. Bring your Lightning wallet — we run a circular-payments game.',
    location: 'The Bitcoin Embassy, Cambridge, UK',
    lat: 52.2053,
    lon: 0.1218,
    daysFromNow: 3,
    durationHours: 3,
    image: `${REPO_RAW}/docs/test-fixtures/cambridge-bitcoin-meetup.jpg`,
    tags: ['bitcoin', 'meetup', 'lightning'],
  },
  {
    d: 'london-bitcoin-devs',
    title: 'London Bitcoin Devs',
    description:
      'Monthly developer-focused Bitcoin meetup. Lightning node operators, Nostr-curious devs, and bitcoin-core hackers welcome.',
    location: 'The Cuckoo Club, Shoreditch, London',
    lat: 51.527,
    lon: -0.082,
    daysFromNow: 6,
    durationHours: 3,
    image: `${REPO_RAW}/docs/test-fixtures/event-london-devs.jpg`,
    tags: ['bitcoin', 'developers', 'london'],
  },
  {
    d: 'edinburgh-bitcoin-beach',
    title: 'Bitcoin Beach Edinburgh',
    description: "Bitcoin-only payments demo + Q&A with merchants. Open to anyone curious about Lightning.",
    location: 'The Auld Hoose, Edinburgh',
    lat: 55.9477,
    lon: -3.1843,
    daysFromNow: 10,
    durationHours: 2,
    image: `${REPO_RAW}/docs/test-fixtures/event-edinburgh-beach.jpg`,
    tags: ['bitcoin', 'scotland', 'lightning'],
  },
  {
    d: 'btc-prague-2026',
    title: 'BTC Prague 2026',
    description:
      "Europe's largest Bitcoin-only conference. Three days of talks, side events, and the legendary speakers' garden.",
    location: 'O2 Universum, Prague',
    lat: 50.105,
    lon: 14.493,
    daysFromNow: 14,
    durationHours: 72,
    image: `${REPO_RAW}/docs/test-fixtures/event-btc-prague.jpg`,
    tags: ['bitcoin', 'conference', 'prague', 'europe'],
  },
  {
    d: 'warsaw-bitcoin-film',
    title: 'Warsaw Bitcoin Film Festival',
    description:
      'Weekend of Bitcoin documentary screenings + panel discussions. Coffee shop accepting Lightning throughout the venue.',
    location: 'Iluzjon Cinema, Warsaw',
    lat: 52.21,
    lon: 21.014,
    daysFromNow: 18,
    durationHours: 48,
    image: `${REPO_RAW}/docs/test-fixtures/event-warsaw-film.jpg`,
    tags: ['bitcoin', 'film', 'warsaw'],
  },
  {
    d: 'bitcoin-park-nashville-meetup',
    title: 'Bitcoin Park Nashville',
    description:
      'Weekly co-working + hangout at Bitcoin Park. Plebs welcome, freedom-tech projects encouraged.',
    location: 'Bitcoin Park, Nashville TN',
    lat: 36.166,
    lon: -86.778,
    daysFromNow: 22,
    durationHours: 6,
    image: `${REPO_RAW}/docs/test-fixtures/event-nashville.jpg`,
    tags: ['bitcoin', 'nashville', 'pleb-lab'],
  },
];

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

const nsecInput = process.env.NSEC;
if (!nsecInput) {
  console.error('NSEC env var required (use Big Piggy nsec or any LP-seeded npub)');
  process.exit(1);
}
const decoded = nip19.decode(nsecInput.trim());
if (decoded.type !== 'nsec') {
  console.error(`Expected nsec1…, got "${decoded.type}"`);
  process.exit(1);
}
const sk = decoded.data;
const pk = getPublicKey(sk);
console.log(`Publishing ${FIXTURES.length} events as ${nip19.npubEncode(pk)}\n`);

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const pool = new SimplePool();
const now = Math.floor(Date.now() / 1000);

for (const f of FIXTURES) {
  const g9 = gh(f.lat, f.lon, 9);
  const start = now + f.daysFromNow * 24 * 60 * 60;
  const end = start + f.durationHours * 60 * 60;
  const evt = finalizeEvent(
    {
      kind: 31923,
      created_at: now,
      tags: [
        ['d', f.d],
        ['title', f.title],
        ...Array.from({ length: 7 }, (_, i) => ['g', g9.slice(0, i + 3)]),
        ['start', String(start)],
        ['end', String(end)],
        ['location', f.location],
        ['image', f.image],
        ...f.tags.map((t) => ['t', t]),
        ['expiration', String(end + 24 * 60 * 60)],
      ],
      content: f.description,
    },
    sk,
  );
  await Promise.allSettled(pool.publish(RELAYS, evt));
  console.log(
    `+${f.daysFromNow}d  ${f.title.padEnd(35)} ${evt.id.slice(0, 12)}… g=${g9.slice(0, 3)}`,
  );
}

await new Promise((r) => setTimeout(r, 1500));
await pool.close(RELAYS);
console.log('\nDone.');
process.exit(0);
