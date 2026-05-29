// Dev helper (#751 freeze repro): bulk-publish many NIP-17 gift-wrapped DMs
// from the LITTLE test account to the BIG test account, so a logged-in BIG
// app builds up a large kind-1059 inbox backlog — the volume that triggers
// the cold-start fetch/ingest freeze we're hunting. NOT shipped — repro tool.
//
//   node --env-file=.env scripts/send-bulk-dms.mjs [count] [concurrency]
//
// Reads MAESTRO_NSEC_LITTLE + MAESTRO_NPUB_BIG from .env. Node 22 has a global
// WebSocket, so nostr-tools' SimplePool works here. Throttled (small batches +
// inter-batch delay) to avoid tripping public-relay rate-limit bans.
import { decode } from 'nostr-tools/nip19';
import { wrapEvent } from 'nostr-tools/nip17';
import { SimplePool } from 'nostr-tools/pool';

const littleNsec = process.env.MAESTRO_NSEC_LITTLE;
const bigNpub = process.env.MAESTRO_NPUB_BIG;
if (!littleNsec || !bigNpub) {
  console.error('Missing MAESTRO_NSEC_LITTLE or MAESTRO_NPUB_BIG (load with --env-file=.env)');
  process.exit(1);
}

const senderSK = decode(littleNsec).data; // Uint8Array
const recipientPk = decode(bigNpub).data; // hex string
const COUNT = Number(process.argv[2] || 500);
const CONC = Number(process.argv[3] || 10);
const DELAY_MS = 250; // pause between batches — be gentle on public relays

// Keep to the most reliable relays the app actually reads (DEFAULT_RELAYS).
const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const pool = new SimplePool();

let ok = 0;
let fail = 0;
const startedAt = Date.now();

console.log(`Seeding ${COUNT} NIP-17 wraps  LITTLE → BIG(${recipientPk.slice(0, 10)}…)  on ${relays.length} relays, conc=${CONC}`);

for (let base = 0; base < COUNT; base += CONC) {
  const batch = [];
  for (let j = 0; j < CONC && base + j < COUNT; j++) {
    const i = base + j;
    const msg = `Repro msg #${i + 1} 🐷 — building NIP-17 inbox backlog for #751 (ts ${Date.now()})`;
    const wrap = wrapEvent(senderSK, { publicKey: recipientPk }, msg);
    batch.push(
      Promise.allSettled(pool.publish(relays, wrap)).then((rs) => {
        const anyOk = rs.some((r) => r.status === 'fulfilled');
        if (anyOk) ok++;
        else fail++;
      }),
    );
  }
  await Promise.all(batch);
  if ((base + CONC) % 50 === 0 || base + CONC >= COUNT) {
    console.log(`  ${Math.min(base + CONC, COUNT)}/${COUNT}  (ok=${ok} fail=${fail}, ${((Date.now() - startedAt) / 1000).toFixed(0)}s)`);
  }
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.log(`done: ${ok} wraps accepted by ≥1 relay, ${fail} failed, in ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
pool.close(relays);
process.exit(0);
