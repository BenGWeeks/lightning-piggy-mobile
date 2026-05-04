#!/usr/bin/env node
// One-shot helper to test the live DM subscription for issue #349.
//
// Sends a NIP-17 1:1 message FROM one Piggy fixture TO another via NIP-59
// gift-wrap, publishing a kind-1059 to the same default relays the app
// subscribes to. The live sub watches kinds 4 + 1059 with `'#p':[viewer]`,
// so the receiving app should render the new conversation row (or a new
// message bubble in an open thread) within a couple of seconds — no
// pull-to-refresh required.
//
// Usage:
//   node scripts/send-nip17-test.mjs [text]
//
// Defaults: from MAESTRO_NSEC3 (Middle Piggy) to MAESTRO_NSEC pubkey (Big Piggy).
// Override via env:
//   FROM_NSEC=$MAESTRO_NSEC4 TO_PUBKEY_HEX=<hex> node scripts/send-nip17-test.mjs "hello"
//
// Notes:
// - Caller must `source .env` (or otherwise export MAESTRO_NSEC*) before running.
// - Does NOT log secrets. Logs sender/recipient pubkey prefixes only.

import { SimplePool, getPublicKey } from 'nostr-tools';
import * as nip17 from 'nostr-tools/nip17';
import * as nip19 from 'nostr-tools/nip19';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

function decodeNsec(nsec) {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error(`expected nsec, got ${decoded.type}`);
  return decoded.data;
}

async function main() {
  const fromNsec = process.env.FROM_NSEC || process.env.MAESTRO_NSEC3;
  if (!fromNsec) throw new Error('FROM_NSEC or MAESTRO_NSEC3 required');
  const fromSk = decodeNsec(fromNsec);
  const fromPk = getPublicKey(fromSk);

  // Recipient pubkey: explicit override OR derive from MAESTRO_NSEC (Big Piggy).
  let toPk = process.env.TO_PUBKEY_HEX;
  if (!toPk) {
    const toNsec = process.env.MAESTRO_NSEC;
    if (!toNsec) throw new Error('TO_PUBKEY_HEX or MAESTRO_NSEC required');
    toPk = getPublicKey(decodeNsec(toNsec));
  }

  const text = process.argv[2] || `live-sub test ${new Date().toISOString().slice(11, 19)}`;
  console.error(
    `[send-nip17-test] from=${fromPk.slice(0, 8)}…  to=${toPk.slice(0, 8)}…  text=${JSON.stringify(text)}`,
  );

  // nip17.wrapEvent builds the kind-13 seal + kind-1059 gift wrap and
  // returns the kind-1059 finalised event ready to publish.
  const wrap = nip17.wrapEvent(fromSk, { publicKey: toPk }, text);
  console.error(`[send-nip17-test] wrap.id=${wrap.id.slice(0, 8)}…  created_at=${wrap.created_at}`);

  const pool = new SimplePool();
  const results = await Promise.allSettled(pool.publish(RELAYS, wrap));
  for (let i = 0; i < RELAYS.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') console.error(`  ${RELAYS[i]} OK`);
    else console.error(`  ${RELAYS[i]} FAIL ${r.reason?.message ?? r.reason}`);
  }
  pool.close(RELAYS);

  // Summary line: stdout so callers can capture / parse.
  process.stdout.write(`${wrap.id}\n`);
}

main().catch((err) => {
  console.error('[send-nip17-test] fatal:', err.message);
  process.exit(1);
});
