// Publishes a NIP-GC kind 37516 "geocache listing" event signed by a
// named Piggy fixture (BIG by default — override with --piggy=ROLE or
// PIGGY_ROLE env). Used for end-to-end testing of the M6
// publish/subscribe shape.
//
// We adopt treasures.to's NIP-GC draft (kind 37516 listings, kind 7516
// found-logs, kind 1111 comments per NIP-22) and mark Lightning-payout
// caches with a **NIP-32 label** (`["L","com.lightningpiggy.app"]` +
// `["l","payout-lnurl-w","com.lightningpiggy.app"]`) — **not** an
// `lnurl` tag. Embedding the LNURL bearer token on the public event
// would let any relay subscriber drain the cache without visiting; it
// stays on the physical NFC tag / QR sticker only. See project memory
// `feedback_lnurl_never_on_relays` + the security unit test in
// `nostrPlacesService.test.ts`. NIP-GC's `D/T/S/t` defaults (difficulty
// 1, terrain 1, size micro, type traditional) are smart for an NFC
// Piggy.
//
//   node scripts/publish-test-piggy.mjs
//
// Override values via env vars: LAT, LON, NAME, MEMO, HINT, PIGGY_ID,
// DIFFICULTY, TERRAIN, SIZE, CACHE_TYPE, AMOUNT_SATS, WAIT_SECONDS, USES.
//
// Note: there is NO `LNURL` env var. The LNURL is intentionally NOT
// part of this script's output — see the schema comment below for
// why. The LNURL belongs on the physical NFC tag / QR sticker the
// hider stashes, not on a relay-broadcast event.
import { finalizeEvent, nip19 } from 'nostr-tools';
import { pickRole, resolvePiggy } from './_piggyFixtures.mjs';
import { SimplePool } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// nostr-tools' API uses a `use*` name but it's a one-shot module-level
// registration, not a React hook — eslint heuristic needs the suppression.
// eslint-disable-next-line react-hooks/rules-of-hooks
useWebSocketImplementation(WebSocket);

// --- Defaults: Big Piggy's Geo-Cache 1 (Longstanton, Cambridge) -------------
const LAT = parseFloat(process.env.LAT ?? '52.283602');
const LON = parseFloat(process.env.LON ?? '0.043889');
const NAME = process.env.NAME ?? 'Longstanton Village Piglet';
const MEMO =
  process.env.MEMO ??
  '🐷 A Lightning Piggy stashed in Longstanton, Cambridge. 21 sats per claim, 3h cooldown, 100 uses.';
const HINT = process.env.HINT ?? 'Look near the bench by the village sign.';
const PIGGY_ID = process.env.PIGGY_ID ?? 'big-piggy-geo-cache-1';
const DIFFICULTY = process.env.DIFFICULTY ?? '1';
const TERRAIN = process.env.TERRAIN ?? '1';
const SIZE = process.env.SIZE ?? 'micro';
const CACHE_TYPE = process.env.CACHE_TYPE ?? 'traditional';
// LP payout-display hints (display-only; the live LNURL on the tag stays authoritative). Empty env var omits the tag.
const AMOUNT_SATS = process.env.AMOUNT_SATS ?? '21';
const WAIT_SECONDS = process.env.WAIT_SECONDS ?? '10800';
const USES = process.env.USES ?? '100';
// Hint photo: by default the script uploads the local test fixture to
// the signer's Blossom server (mirrors the real Hide-a-Piglet flow) and
// tags the returned blob URL — never a repo-hosted URL. IMAGE=https://…
// skips the upload + tags a pre-hosted URL; IMAGE= (empty) → no image.
const IMAGE_FILE = process.env.IMAGE_FILE ?? 'docs/test-fixtures/geo-cache-1-telephone.jpg';
const BLOSSOM_SERVER = (process.env.BLOSSOM_SERVER ?? 'https://blossom.primal.net').replace(
  /\/+$/,
  '',
);
// Whether to attach the Lightning Piggy NIP-32 label. Set LP_LABEL=0 to
// publish a vanilla NIP-GC cache (treasures.to / TapTheSatsMap style)
// so the in-app feed has something to render with the alternate pin.
const LP_LABEL = process.env.LP_LABEL !== '0';

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

// Upload a local image to a Blossom server (BUD-02), signed with `sk` so
// it lands on this user's server — mirrors services/blossomService in the
// app. Returns the blob URL to tag on the event.
async function uploadToBlossom(filePath, server, sk) {
  const bytes = readFileSync(filePath);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const nowSec = Math.floor(Date.now() / 1000);
  const auth = finalizeEvent(
    {
      kind: 24242,
      created_at: nowSec,
      content: 'Upload image',
      tags: [
        ['t', 'upload'],
        ['x', hash],
        ['expiration', String(nowSec + 300)],
      ],
    },
    sk,
  );
  const res = await fetch(`${server}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: 'Nostr ' + Buffer.from(JSON.stringify(auth)).toString('base64'),
      'Content-Type': 'image/jpeg',
    },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`Blossom upload failed: HTTP ${res.status} — ${await res.text()}`);
  }
  const blob = await res.json();
  if (!blob.url) throw new Error('Blossom upload: no `url` in response');
  return blob.url;
}

// Multi-precision g tags per the NIP-GC suggestion (3-9 chars).
const g9 = gh(LAT, LON, 9);

// Signing key — sourced from one of the named MAESTRO_NSEC_* fixtures
// (see scripts/_piggyFixtures.mjs). Defaults to BIG; override with
// --piggy=MIDDLE|LITTLE|EVIL or PIGGY_ROLE env. No random-key fallback:
// disposable keys leave orphan pubkeys littering relays on every run.
const ROLE = pickRole({ defaultRole: 'BIG' });
const { sk, pk } = resolvePiggy(ROLE);
console.log(`Signing as ${ROLE} Piggy — event replaceable by this npub.`);
const npub = nip19.npubEncode(pk);

// Resolve the hint-photo URL. Default: upload the local fixture to the
// signer's Blossom server. IMAGE=… env override skips the upload.
let IMAGE;
if (process.env.IMAGE !== undefined) {
  IMAGE = process.env.IMAGE; // explicit override (empty string → no image tag)
} else {
  IMAGE = await uploadToBlossom(IMAGE_FILE, BLOSSOM_SERVER, sk);
  console.log('Uploaded hint photo to Blossom →', IMAGE);
}

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
// We mark Lightning-payout caches via a NIP-32 label: ["L", "com.lightningpiggy.app"]
// (namespace) + ["l", "payout-lnurl-w", "com.lightningpiggy.app"] (label value within
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
  ...(IMAGE ? [['image', IMAGE]] : []),
  // --- Lightning Piggy marker (NIP-32 label, not a bearer token!) ---
  // Skipped with LP_LABEL=0 so the cache renders as a generic NIP-GC
  // listing (the in-app feed shows it with the alternate 📍 pin).
  ...(LP_LABEL
    ? [
        ['L', 'com.lightningpiggy.app'],
        ['l', 'payout-lnurl-w', 'com.lightningpiggy.app'],
      ]
    : []),
  // LP payout-display hints — only on labelled Piggies, never the LNURL itself.
  ...(LP_LABEL && AMOUNT_SATS ? [['amount', AMOUNT_SATS]] : []),
  ...(LP_LABEL && WAIT_SECONDS ? [['wait', WAIT_SECONDS]] : []),
  ...(LP_LABEL && USES ? [['uses', USES]] : []),
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
