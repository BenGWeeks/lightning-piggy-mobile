// Diagnostic: what did Big Piggy actually publish in the last 10 min?
// Lists kind-4 events authored by Big Piggy.
//
// IMPORTANT — kind-1059 by author returns ZERO BY DESIGN. NIP-59 wraps
// are signed with an *ephemeral* pubkey to hide the real sender, so
// `authors: [bigPiggyPk]` will never match. To verify NIP-17 outbound,
// run scripts/verify-recv.mjs as the recipient (decrypts the wrap and
// surfaces the inner rumor.pubkey, which IS the real sender).
//
// Use this script to detect "still on legacy kind-4 path" — if kind-4
// shows recent events and kind-1059 verify-recv finds nothing, the dev
// app hasn't migrated. If kind-4 is empty and verify-recv finds the
// marker, the migration is live.
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
// NIP-59 randomises wrap.created_at up to 2 days back for plausible deniability — a `since` filter would silently drop fresh wraps. Pull the latest N and let the caller eyeball.
const k1059 = await pool.querySync(RELAYS, { kinds: [1059], authors: [pk], limit: 20 });

console.log(`[bigpiggy-outbox] kind-4 in last 10 min: ${k4.length}`);
for (const ev of k4) {
  const pTag = ev.tags.find((t) => t[0] === 'p')?.[1] || '(no p)';
  console.log(`  ${ev.id.slice(0, 8)} → ${pTag.slice(0, 8)} at ${ev.created_at}`);
}
console.log(`[bigpiggy-outbox] kind-1059 (latest ${k1059.length}, no since filter): `);
for (const ev of k1059) {
  const pTag = ev.tags.find((t) => t[0] === 'p')?.[1] || '(no p)';
  console.log(`  ${ev.id.slice(0, 8)} → ${pTag.slice(0, 8)} at ${ev.created_at}`);
}
console.log(
  `[bigpiggy-outbox] verdict: ${k1059.length > 0 ? 'NIP-17 path active' : k4.length > 0 ? 'still on legacy kind-4 path' : 'no outgoing DM events found'}`,
);
pool.close(RELAYS);
