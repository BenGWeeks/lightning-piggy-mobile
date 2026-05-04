// Diagnostic: what did Big Piggy actually publish in the last 10 min?
// Lists all kind-4 + kind-1059 events authored by Big Piggy. Used to
// confirm whether the dev app is on PR-334's NIP-17 send path or still
// on the legacy kind-4 path.
//
// Usage: MAESTRO_NSEC=$bigpiggy_nsec node scripts/verify-bigpiggy-outbox.mjs

import { SimplePool } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const nsec = process.env.MAESTRO_NSEC;
if (!nsec) {
  console.error('MAESTRO_NSEC required');
  process.exit(1);
}
const sk = nip19.decode(nsec).data;
const pk = getPublicKey(sk);
console.log(`[bigpiggy-outbox] author pk=${pk.slice(0, 8)}…`);

const pool = new SimplePool();
const since = Math.floor(Date.now() / 1000) - 600;

const k4 = await pool.querySync(RELAYS, { kinds: [4], authors: [pk], since });
const k1059 = await pool.querySync(RELAYS, { kinds: [1059], authors: [pk], since });

console.log(`[bigpiggy-outbox] kind-4 in last 10 min: ${k4.length}`);
for (const ev of k4) {
  const pTag = ev.tags.find((t) => t[0] === 'p')?.[1] || '(no p)';
  console.log(`  ${ev.id.slice(0, 8)} → ${pTag.slice(0, 8)} at ${ev.created_at}`);
}
console.log(`[bigpiggy-outbox] kind-1059 in last 10 min: ${k1059.length}`);
for (const ev of k1059) {
  const pTag = ev.tags.find((t) => t[0] === 'p')?.[1] || '(no p)';
  console.log(`  ${ev.id.slice(0, 8)} → ${pTag.slice(0, 8)} at ${ev.created_at}`);
}
console.log(
  `[bigpiggy-outbox] verdict: ${k1059.length > 0 ? 'NIP-17 path active' : k4.length > 0 ? 'still on legacy kind-4 path' : 'no outgoing DM events found'}`,
);
pool.close(RELAYS);
