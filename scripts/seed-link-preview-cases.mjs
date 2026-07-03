#!/usr/bin/env node
// Seeds a curated set of NIP-17 DMs covering the link-preview matrix
// (Twitter / x.com / YouTube / Wikipedia / GitHub) with text BEFORE,
// AFTER, and EITHER SIDE of the URL. Used to refresh the PR #449
// screenshot fixture (`docs/screenshots/441/various-states.png`)
// after the regex+wiring fixes for #441.
//
// Usage:
//   node scripts/seed-link-preview-cases.mjs                # MAESTRO_NSEC_BIG → MAESTRO_NSEC_LITTLE
//   node scripts/seed-link-preview-cases.mjs FROM TO        # custom env var pair
//
// Both sender + recipient are read as env-var names (e.g.
// MAESTRO_NSEC_BIG) — never raw nsecs on the command line.

import { readFileSync, existsSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { SimplePool } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';
import * as nip17 from 'nostr-tools/nip17';
import { getPublicKey } from 'nostr-tools/pure';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

if (!existsSync('.env')) {
  console.error('No .env in cwd — run from the repo root.');
  exit(1);
}
const envText = readFileSync('.env', 'utf8');
function valueFor(key) {
  const line = envText.split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : null;
}

const fromEnv = argv[2] || 'MAESTRO_NSEC_BIG';
const toEnv = argv[3] || 'MAESTRO_NSEC_LITTLE';

const fromNsec = valueFor(fromEnv);
const toNsec = valueFor(toEnv);
if (!fromNsec || !toNsec) {
  console.error(`Missing env: ${!fromNsec ? fromEnv : toEnv}`);
  exit(1);
}
const fromSk = nip19.decode(fromNsec).data;
const toSk = nip19.decode(toNsec).data;
const fromPk = getPublicKey(fromSk);
const toPk = getPublicKey(toSk);

console.log(`[seed] from=${fromEnv} (${fromPk.slice(0, 8)}…)`);
console.log(`[seed] to  =${toEnv} (${toPk.slice(0, 8)}…)`);

// The matrix. Each entry is one DM. Ordered top-to-bottom so the
// resulting screenshot reads as a coherent chat thread.
const MESSAGES = [
  // Wikipedia — text before
  'Check this out: https://en.wikipedia.org/wiki/Bitcoin',
  // Wikipedia — text after
  'https://en.wikipedia.org/wiki/Lightning_Network is the L2 you want',
  // Wikipedia — text either side, balanced parens
  'See https://en.wikipedia.org/wiki/Bitcoin_(currency) which covers history',
  // Twitter — text before
  'Read this 🐦 https://twitter.com/jack/status/20',
  // x.com (rebrand) — text after
  'https://x.com/elonmusk/status/9999 is the latest take',
  // YouTube — text before
  'watch this 🎵 https://youtube.com/watch?v=dQw4w9WgXcQ',
  // YouTube short form — text either side
  'try https://youtu.be/dQw4w9WgXcQ now (timestamped)',
  // GitHub — text either side, with trailing question
  'did you see https://github.com/lightning-piggy/lightning-piggy?',
  // Multi-link single message — first non-blocklisted wins
  'compare https://en.wikipedia.org/wiki/Bitcoin with https://en.wikipedia.org/wiki/Lightning_Network please',
  // Blocklisted host (should render bare, no preview)
  'Join my Slack: https://join.slack.com/test/abc123',
];

const pool = new SimplePool();
let okCount = 0;
let errCount = 0;
for (let i = 0; i < MESSAGES.length; i++) {
  const msg = MESSAGES[i];
  const wrap = nip17.wrapEvent(fromSk, { publicKey: toPk }, msg);
  try {
    await Promise.any(pool.publish(RELAYS, wrap));
    okCount++;
    console.log(`[seed] ${i + 1}/${MESSAGES.length} ✓ ${msg.slice(0, 60)}…`);
  } catch (err) {
    errCount++;
    console.error(`[seed] ${i + 1}/${MESSAGES.length} ✗ ${err?.message || err}`);
  }
  // Spread the writes by 600ms so the relay-side ordering is stable
  // (created_at is set by wrapEvent; this just prevents pool churn).
  await new Promise((r) => setTimeout(r, 600));
}

await new Promise((r) => setTimeout(r, 1500));
pool.close(RELAYS);

console.log(`\n[seed] done — ${okCount}/${MESSAGES.length} published, ${errCount} failed`);
exit(errCount > 0 ? 1 : 0);
