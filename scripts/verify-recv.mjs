// Verifies a NIP-17 wrap addressed to Little Piggy (MAESTRO_NSEC2)
// containing the marker text reaches the relays. Used as the
// "actually received?" check after the Maestro DM-send flow.
//
// Usage: MAESTRO_NSEC2=$nsec node /tmp/verify-recv.mjs "PR334 NIP-17 000622"

import { SimplePool } from 'nostr-tools/pool';
import * as nip17 from 'nostr-tools/nip17';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const marker = process.argv[2];
if (!marker) {
  console.error('usage: node verify-recv.mjs <marker text>');
  process.exit(1);
}

const nsec = process.env.MAESTRO_NSEC2;
if (!nsec) {
  console.error('MAESTRO_NSEC2 not in env');
  process.exit(1);
}
const decoded = nip19.decode(nsec);
if (decoded.type !== 'nsec') {
  console.error('not an nsec');
  process.exit(1);
}
const sk = decoded.data;
const pk = getPublicKey(sk);
console.log(`[verify-recv] recipient pk=${pk.slice(0, 8)}…`);
console.log(`[verify-recv] looking for marker "${marker}" in any kind-1059 from last 10 min`);

const pool = new SimplePool();
const since = Math.floor(Date.now() / 1000) - 600;
const events = await pool.querySync(RELAYS, {
  kinds: [1059],
  '#p': [pk],
  // NIP-59 randomises wrap.created_at by up to 2 days; can't use 'since' on the wrap, so omit and filter rumors after decrypt.
});
console.log(`[verify-recv] fetched ${events.length} kind-1059 wraps tagged ${pk.slice(0, 8)}`);

let found = false;
let decrypted = 0;
for (const wrap of events) {
  try {
    const rumor = nip17.unwrapEvent(wrap, sk);
    decrypted++;
    if (rumor.content.includes(marker) && rumor.created_at >= since) {
      console.log(
        `[verify-recv] MATCH: rumor.content="${rumor.content}" from=${rumor.pubkey.slice(0, 8)} at=${rumor.created_at} wrap.id=${wrap.id.slice(0, 8)}`,
      );
      found = true;
    }
  } catch {
    // undecryptable (not for us)
  }
}
console.log(`[verify-recv] decrypted ${decrypted}/${events.length} wraps`);
console.log(`[verify-recv] result: ${found ? 'RECEIVED ✓' : 'NOT FOUND ✗'}`);
pool.close(RELAYS);
process.exit(found ? 0 : 2);
