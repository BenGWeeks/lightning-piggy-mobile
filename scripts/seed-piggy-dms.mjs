#!/usr/bin/env node
// Seed extra NIP-17 DMs between the three Piggy test accounts. Use this
// to grow the gift-wrap backlog when reproducing cold-start perf issues
// that scale with inbox depth (e.g. the v1.0.2 "Send sheet frozen for
// ~12s" symptom). All Piggies follow each other already.
//
// Usage:
//   node scripts/seed-piggy-dms.mjs [count]
//
// Reads MAESTRO_NSEC_BIG / MAESTRO_NSEC_MIDDLE / MAESTRO_NSEC_LITTLE
// from .env. Picks random sender→recipient pairs, sends `count` wraps
// (default 30). NIP-59 randomises the outer kind-1059 timestamp by
// design, so we don't try to stage it ourselves.
//
// NOT for production — only the three Piggy test identities.

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

function readEnv() {
  if (!existsSync('.env')) return new Map();
  const out = new Map();
  // Split on CRLF + LF so Windows-edited .env files parse cleanly,
  // and trim trailing \r on the value (the `(.*)$` capture doesn't
  // exclude it). Per Copilot review on PR #507.
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out.set(m[1], m[2].replace(/\r$/, '').trim());
  }
  return out;
}

function decodeNsec(nsec) {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error('expected nsec');
  return decoded.data;
}

const PHRASES = [
  'morning piggy',
  'did you see the price?',
  'lightning is fast today',
  'lol',
  'sent you sats',
  'where are you',
  '🐷',
  'hello hello',
  'check your inbox',
  'gm',
  'gn',
  'ack',
  'wen mooon',
  'nostr is comfy',
  'big day tomorrow',
  'see you sat',
  'ok will do',
  '👍',
  'roast me',
  'whats for dinner',
  'piggy bank topped up',
  'sending love',
  'on it',
  'wait what',
  'classic',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  const count = Number(argv[2] ?? 30);
  // `Number.isInteger` rejects `2.5` and friends — `Number.isFinite`
  // alone passed them. Per Copilot review on PR #507.
  if (!Number.isInteger(count) || count < 1) {
    console.error('count must be a positive integer');
    exit(1);
  }

  const env = readEnv();
  const nsecs = {
    big: env.get('MAESTRO_NSEC_BIG'),
    middle: env.get('MAESTRO_NSEC_MIDDLE'),
    little: env.get('MAESTRO_NSEC_LITTLE'),
  };
  for (const [name, val] of Object.entries(nsecs)) {
    if (!val) {
      console.error(`Missing MAESTRO_NSEC_${name.toUpperCase()} in .env`);
      exit(1);
    }
  }

  const piggies = Object.entries(nsecs).map(([name, nsec]) => {
    const sk = decodeNsec(nsec);
    return { name, sk, pk: getPublicKey(sk) };
  });

  console.log(`Seeding ${count} NIP-17 DMs between Big / Middle / Little Piggy`);
  for (const p of piggies) console.log(`  ${p.name.padEnd(7)} ${p.pk}`);

  const pool = new SimplePool();

  let sent = 0;
  for (let i = 0; i < count; i++) {
    const sender = piggies[Math.floor(Math.random() * piggies.length)];
    const others = piggies.filter((p) => p !== sender);
    const recipient = others[Math.floor(Math.random() * others.length)];
    const message = pick(PHRASES);
    const wrap = nip17.wrapEvent(sender.sk, { publicKey: recipient.pk }, message);
    await Promise.allSettled(pool.publish(RELAYS, wrap));
    sent++;
    if (sent % 5 === 0) console.log(`  ${sent}/${count}`);
  }

  await new Promise((r) => setTimeout(r, 2000));
  pool.close(RELAYS);
  console.log(`Done. Sent ${sent} wraps to ${RELAYS.length} relays.`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
