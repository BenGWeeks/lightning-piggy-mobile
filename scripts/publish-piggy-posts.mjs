#!/usr/bin/env node
// Publishes a small set of kind-1 notes for each Piggy test fixture so
// the friends-profile feed (#435 / #439) has something to render in dev
// flows + screenshot captures. Idempotent enough — re-running posts
// duplicate notes, so don't run on a schedule. The notes are intentionally
// short, friendly, on-brand for the test fixtures.
//
// Usage:
//   node scripts/publish-piggy-posts.mjs              # all four
//   node scripts/publish-piggy-posts.mjs MAESTRO_NSEC_BIG # one Piggy
//
// Reads each MAESTRO_NSEC_BIG* from .env. Never logs the nsec.

import { readFileSync, existsSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { SimplePool } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const PIGGIES = [
  {
    envVar: 'MAESTRO_NSEC_BIG',
    label: 'Big Piggy',
    notes: [
      "Saving sats one swipe at a time. 🐷",
      "If your bank says no, your wallet should say sure thing.",
      "Family-friendly Lightning. No keys lost on my watch.",
    ],
  },
  {
    envVar: 'MAESTRO_NSEC_LITTLE',
    label: 'Little Piggy',
    notes: [
      "Tiniest sats matter. ✨",
      "Mum gave me 21 sats today. Already plotting how to spend them.",
    ],
  },
  {
    envVar: 'MAESTRO_NSEC_MIDDLE',
    label: 'Middle Piggy',
    notes: [
      "Caught between Big Piggy's lectures and Little Piggy's pranks. Living the dream.",
      "Nostr-only since I forgot my Twitter password.",
      "Zap me if you've ever watched two ads to skip one ad.",
    ],
  },
  {
    envVar: 'MAESTRO_NSEC_EVIL',
    label: 'Evil Piggy',
    notes: [
      "Plotting. Always plotting.",
      "If you can read this, you've already lost.",
    ],
  },
];

if (!existsSync('.env')) {
  console.error('No .env file in cwd — run from the repo root.');
  exit(1);
}
const envText = readFileSync('.env', 'utf8');
function nsecFor(envVar) {
  const line = envText.split('\n').find((l) => l.startsWith(`${envVar}=`));
  if (!line) return null;
  return line.slice(envVar.length + 1).trim();
}

const onlyEnvVar = argv[2];
const targets = onlyEnvVar ? PIGGIES.filter((p) => p.envVar === onlyEnvVar) : PIGGIES;
if (onlyEnvVar && targets.length === 0) {
  console.error(`Unknown env var: ${onlyEnvVar}.`);
  exit(1);
}

const pool = new SimplePool();
let exitCode = 0;

for (const piggy of targets) {
  const { envVar, label, notes } = piggy;
  console.log(`\n=== ${label} (${envVar}) ===`);
  const nsec = nsecFor(envVar);
  if (!nsec) {
    console.error(`  ${envVar} not set — skipping`);
    exitCode = 1;
    continue;
  }
  let secretKey;
  let pubkey;
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('not an nsec');
    secretKey = decoded.data;
    pubkey = getPublicKey(secretKey);
  } catch (err) {
    console.error(`  ${envVar} decode failed: ${err?.message || err}`);
    exitCode = 1;
    continue;
  }
  console.log(`  pubkey: ${pubkey}`);

  // Stagger created_at timestamps backwards (most recent first), so the
  // notes don't all share the same timestamp on relays that dedupe.
  const baseTs = Math.floor(Date.now() / 1000);
  for (let i = 0; i < notes.length; i++) {
    const event = finalizeEvent(
      {
        kind: 1,
        created_at: baseTs - i * 600,
        tags: [],
        content: notes[i],
      },
      secretKey,
    );
    process.stdout.write(`  publishing kind-1 ${event.id.slice(0, 12)} … `);
    const results = await Promise.allSettled(pool.publish(RELAYS, event));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    console.log(`${ok}/${RELAYS.length} relays ok`);
    // Small breather to avoid rate-limiting on Damus.
    await new Promise((r) => setTimeout(r, 800));
  }
}

pool.close(RELAYS);
exit(exitCode);
