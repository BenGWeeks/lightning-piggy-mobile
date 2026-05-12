// Seeds 2-3 kind 7516 NIP-GC found-log events against Big Piggy's
// Geo-Cache 1 so the HuntPiggyDetail screen's "Find log" section has
// realistic entries for screenshots + UX testing.
//
// Each find is signed by a different Piggy fixture (Big / Middle /
// Little) so the in-app `usePubkeyProfile` lookup resolves real
// kind-0 display names + avatars, not anonymous hex pubkeys. (An
// earlier version used `generateSecretKey()` per find — fresh
// disposable keys that have no published kind-0 profile, so the find
// rows fell back to a generic User icon.)
//
//   node scripts/publish-test-find-logs.mjs
//
// Override the cache via CACHE_COORD env var (default = the Big Piggy
// Geo-Cache 1 coord baked into publish-test-piggy.mjs).
import { getPublicKey, finalizeEvent, nip19 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import WebSocket from 'ws';

// eslint-disable-next-line react-hooks/rules-of-hooks
useWebSocketImplementation(WebSocket);

// Big Piggy's npub (hex) + Geo-Cache 1 d-tag → coord. Override with
// CACHE_COORD=37516:<pubkey>:<d-tag> to target a different cache.
const DEFAULT_COORD =
  '37516:b8d38e654adff224418002ae752155a84a86dab6fa94b4bc9e81ca9e25dce9e7:big-piggy-geo-cache-1';
const CACHE_COORD = process.env.CACHE_COORD ?? DEFAULT_COORD;

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

// Resolve nsec env vars to raw secret keys so each find signs as the
// Piggy fixture it's meant to come from (real kind-0 profile = real
// avatar + display name in the app's find log).
const resolveNsec = (envVar) => {
  const v = process.env[envVar];
  if (!v) throw new Error(`Missing env var: ${envVar}`);
  const decoded = nip19.decode(v.trim());
  if (decoded.type !== 'nsec') throw new Error(`${envVar}: expected nsec, got ${decoded.type}`);
  return decoded.data;
};

// Three realistic-looking finds — different tones (terse / chatty /
// pictures-or-it-didn't-happen) + different sats amounts. Each is
// signed by a different Piggy fixture so the find log shows three
// distinct profile chips. No images for now to keep the script free
// of upload deps; the parser falls back gracefully.
const FINDS = [
  {
    nsecEnv: 'MAESTRO_NSEC_MIDDLE',
    age_seconds: 6 * 60 * 60, // 6 h ago
    sats: 21,
    content:
      'Quick lunchtime find! Nailed in seconds — telephone box was a dead giveaway. Cheers for the sats 🐷',
  },
  {
    nsecEnv: 'MAESTRO_NSEC_LITTLE',
    age_seconds: 2 * 24 * 60 * 60, // 2 d ago
    sats: 21,
    content: 'Spotted it on the way through Longstanton. Beautiful spot — added to my saved list.',
  },
  {
    nsecEnv: 'MAESTRO_NSEC_EVIL',
    age_seconds: 5 * 24 * 60 * 60, // 5 d ago
    sats: 21,
    content:
      'Walking the dog and stumbled on this. First Piglet I’ve ever claimed — really clever idea, going to hide one of my own.',
  },
];

const pool = new SimplePool();
const now = Math.floor(Date.now() / 1000);
const results = [];
for (const find of FINDS) {
  const sk = resolveNsec(find.nsecEnv);
  const pk = getPublicKey(sk);
  const evt = finalizeEvent(
    {
      kind: 7516,
      created_at: now - find.age_seconds,
      tags: [
        ['a', CACHE_COORD],
        ['amount', String(find.sats)],
      ],
      content: find.content,
    },
    sk,
  );
  const ack = await Promise.allSettled(pool.publish(RELAYS, evt));
  results.push({ pk: pk.slice(0, 8), id: evt.id.slice(0, 16), ack });
  console.log(
    `published ${evt.id.slice(0, 16)}… by ${pk.slice(0, 8)}… (${find.content.slice(0, 50)}…)`,
  );
}

await new Promise((r) => setTimeout(r, 1500));
const fetched = await pool.querySync(RELAYS, { kinds: [7516], '#a': [CACHE_COORD], limit: 50 });
console.log(`\n--- re-fetch by #a=${CACHE_COORD} → ${fetched.length} event(s) ---`);

await pool.close(RELAYS);
process.exit(0);
