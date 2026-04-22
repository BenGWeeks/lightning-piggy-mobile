#!/usr/bin/env node
// Publishes a kind-3 that appends a new pubkey to an account's existing
// follow list. Fetches the current kind-3 first so we don't wipe the
// existing 500+ follows.
//
// Usage:
//   node scripts/add-nostr-contact.mjs <OWNER_ENV_VAR> <target-npub-or-hex>

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

const [, , envVar, target] = argv;
if (!envVar || !target) {
  console.error('Usage: node add-nostr-contact.mjs <OWNER_ENV_VAR> <target-npub-or-hex>');
  exit(1);
}
if (!existsSync('.env')) {
  console.error('No .env file in cwd');
  exit(1);
}
const envLine = readFileSync('.env', 'utf8')
  .split('\n')
  .find((l) => l.startsWith(`${envVar}=`));
if (!envLine) {
  console.error(`${envVar} not set in .env`);
  exit(1);
}
const nsec = envLine.slice(envVar.length + 1);
const decoded = nip19.decode(nsec);
if (decoded.type !== 'nsec') {
  console.error(`${envVar} is not an nsec`);
  exit(1);
}
const secretKey = decoded.data;
const ownerPubkey = getPublicKey(secretKey);

// Normalise target
let targetHex = target.trim();
if (targetHex.startsWith('nostr:')) targetHex = targetHex.slice(6);
if (targetHex.startsWith('npub1')) {
  const t = nip19.decode(targetHex);
  if (t.type !== 'npub') throw new Error('Target is not an npub');
  targetHex = t.data;
}
if (!/^[0-9a-f]{64}$/i.test(targetHex)) {
  console.error('Target is not a valid pubkey');
  exit(1);
}
targetHex = targetHex.toLowerCase();

const pool = new SimplePool();

console.log(`[${envVar}] fetching current kind 3 for ${ownerPubkey.slice(0, 12)}...`);
const current = await pool.get(RELAYS, { kinds: [3], authors: [ownerPubkey] });

const existingTags = current?.tags ?? [];
const alreadyFollows = existingTags.some((t) => t[0] === 'p' && t[1] === targetHex);
if (alreadyFollows) {
  console.log(`[${envVar}] already following ${targetHex.slice(0, 12)}... — nothing to do`);
  pool.close(RELAYS);
  exit(0);
}

const newTags = [...existingTags.filter((t) => t[0] === 'p'), ['p', targetHex]];
const event = finalizeEvent(
  {
    kind: 3,
    created_at: Math.floor(Date.now() / 1000),
    tags: newTags,
    content: current?.content ?? '',
  },
  secretKey,
);

console.log(
  `[${envVar}] publishing kind 3 ${event.id} with ${newTags.length} follows (was ${existingTags.filter((t) => t[0] === 'p').length})`,
);

const results = await Promise.allSettled(pool.publish(RELAYS, event));
for (let i = 0; i < RELAYS.length; i++) {
  const r = results[i];
  console.log(
    `[${envVar}] ${RELAYS[i]} — ${r.status}${r.status === 'rejected' ? ': ' + r.reason : ''}`,
  );
}
await new Promise((r) => setTimeout(r, 1500));
pool.close(RELAYS);
