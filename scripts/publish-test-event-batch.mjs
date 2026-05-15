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
import { finalizeEvent, nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';
import { pickRole, resolvePiggy } from './_piggyFixtures.mjs';

// eslint-disable-next-line react-hooks/rules-of-hooks
useWebSocketImplementation(WebSocket);

const REPO_RAW = 'https://github.com/BenGWeeks/lightning-piggy-mobile/raw/main';
const FIXTURES = [
  {
    d: 'cambridge-bitcoin-drinks',
    title: 'Trotters and Toasties 🐷',
    description:
      "Cambridge bitcoin breakfast. Bacon butties, hot coffee, and a Lightning faucet on the counter — pay your toastie in sats. First-timers welcome; we'll help you onboard your first wallet over breakfast.",
    location: 'The Bitcoin Embassy, Cambridge, UK',
    lat: 52.2053,
    lon: 0.1218,
    daysFromNow: 3,
    durationHours: 3,
    image: `${REPO_RAW}/docs/test-fixtures/cambridge-bitcoin-meetup.jpg`,
    tags: ['bitcoin', 'meetup', 'lightning', 'breakfast'],
  },
  {
    d: 'london-bitcoin-devs',
    title: 'Snouts and Sats 🐽',
    description:
      'London pleb night for Lightning node operators, Nostr-curious devs, and bitcoin-core hackers. Truffle out the bugs together. Pints, sats, and snouts deep in code.',
    location: 'The Cuckoo Club, Shoreditch, London',
    lat: 51.527,
    lon: -0.082,
    daysFromNow: 6,
    durationHours: 3,
    image: `${REPO_RAW}/docs/test-fixtures/event-london-devs.jpg`,
    tags: ['bitcoin', 'lightning', 'developers', 'london'],
  },
  {
    d: 'edinburgh-bitcoin-beach',
    title: 'The Highland Hog Roast 🐖🔥',
    description:
      'Edinburgh bitcoin BBQ. Whole-hog roast paid in sats. Bring a Lightning wallet — every pint of ale, every cut of pork, every haggis is a Lightning invoice. Plebs of all sizes welcome.',
    location: 'The Auld Hoose, Edinburgh',
    lat: 55.9477,
    lon: -3.1843,
    daysFromNow: 10,
    durationHours: 4,
    image: `${REPO_RAW}/docs/test-fixtures/event-edinburgh-beach.jpg`,
    tags: ['bitcoin', 'meetup', 'lightning', 'scotland'],
  },
  {
    d: 'btc-prague-2026',
    title: 'Pigs in Space 🐷🚀',
    description:
      "Three days of talks, side events, and the legendary speakers' garden at BTC Prague 2026. We're sending plebs to orbit. Conference accepts only Lightning at every food truck.",
    location: 'O2 Universum, Prague',
    lat: 50.105,
    lon: 14.493,
    daysFromNow: 14,
    durationHours: 72,
    image: `${REPO_RAW}/docs/test-fixtures/event-btc-prague.jpg`,
    tags: ['bitcoin', 'conference', 'lightning', 'prague'],
  },
  {
    d: 'warsaw-bitcoin-film',
    title: 'Hog Wild Film Festival 🐷🎬',
    description:
      "Warsaw bitcoin cinema weekend. Doco screenings (Hard Money, The Great Unbanking, Big Pig's Long Walk), panel discussions with the directors. Popcorn paid in sats.",
    location: 'Iluzjon Cinema, Warsaw',
    lat: 52.21,
    lon: 21.014,
    daysFromNow: 18,
    durationHours: 48,
    image: `${REPO_RAW}/docs/test-fixtures/event-warsaw-film.jpg`,
    tags: ['bitcoin', 'film', 'lightning', 'warsaw'],
  },
  {
    d: 'bitcoin-park-nashville-meetup',
    title: 'Bacon and Sats BBQ 🥓⚡',
    description:
      'Nashville pig-out at Bitcoin Park. Co-working all day, smokehouse plate at sunset, freedom-tech demos in between. Plebs welcome, BYO wallet.',
    location: 'Bitcoin Park, Nashville TN',
    lat: 36.166,
    lon: -86.778,
    daysFromNow: 22,
    durationHours: 6,
    image: `${REPO_RAW}/docs/test-fixtures/event-nashville.jpg`,
    tags: ['bitcoin', 'meetup', 'lightning', 'nashville'],
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

const ROLE = pickRole({ defaultRole: 'BIG' });
const { sk, pk } = resolvePiggy(ROLE);
console.log(`Signing as ${ROLE} Piggy.`);
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
