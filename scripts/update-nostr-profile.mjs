#!/usr/bin/env node
// Publishes a kind-0 profile event on behalf of an account whose nsec is
// stored in .env. Used by the automated test pipeline to rename test
// accounts without going through the LP Edit Profile UI (which has a
// separate known bug — see #141).
//
// Usage:
//   node scripts/update-nostr-profile.mjs <ENV_VAR_OF_NSEC> <name> [picture-url] [banner-url] [about]
//
// Example:
//   node scripts/update-nostr-profile.mjs MAESTRO_NSEC \
//     "Big Piggy" \
//     "https://raw.githubusercontent.com/BenGWeeks/lightning-piggy-mobile/claude/pr-issue-112-b1og0/assets/images/lightning-piggy-intro.png" \
//     "https://raw.githubusercontent.com/BenGWeeks/lightning-piggy-mobile/claude/pr-issue-112-b1og0/assets/images/lightning-piggy-intro.png" \
//     "Automated test account A. Big brother to Little Piggy."

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

const [, , envVar, name, picture, banner, about] = argv;
if (!envVar || !name) {
  console.error('Usage: node update-nostr-profile.mjs <ENV_VAR> <name> [picture] [banner] [about]');
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
const pubkey = getPublicKey(secretKey);

const payload = { name, display_name: name };
if (picture) payload.picture = picture;
if (banner) payload.banner = banner;
if (about) payload.about = about;

const event = finalizeEvent(
  {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(payload),
  },
  secretKey,
);

console.log(`[${envVar}] pubkey: ${pubkey}`);
console.log(`[${envVar}] npub:   ${nip19.npubEncode(pubkey)}`);
console.log(`[${envVar}] publishing kind 0 ${event.id} with name="${name}"`);

const pool = new SimplePool();
const results = await Promise.allSettled(pool.publish(RELAYS, event));
for (let i = 0; i < RELAYS.length; i++) {
  const r = results[i];
  console.log(`[${envVar}] ${RELAYS[i]} — ${r.status}${r.status === 'rejected' ? ': ' + r.reason : ''}`);
}
await new Promise((r) => setTimeout(r, 1500));
pool.close(RELAYS);
