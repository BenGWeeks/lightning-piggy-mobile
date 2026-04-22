#!/usr/bin/env node
// Testing helper: sends a NIP-17 gift-wrapped DM from a locally-generated
// "Account B" nsec to a target pubkey (Account A). Also publishes a kind-0
// profile for B and a kind-3 contact list following A so that A's
// Following-only inbox filter will surface the message.
//
// Usage:
//   node scripts/send-nip17-from-test-account.mjs <recipient-npub-or-hex> [message]
//
// The sender nsec is persisted in .env as TEST_ACCOUNT_B_NSEC so subsequent
// runs keep the same identity. First run generates + saves.
//
// NOT for production — don't use this key for anything else.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { SimplePool } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';
import * as nip17 from 'nostr-tools/nip17';
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} from 'nostr-tools/pure';

// Must also be reachable from the emulator when it fetches. Matches the
// DEFAULT_RELAYS list in src/services/nostrService.ts.
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const ENV_PATH = '.env';
const ENV_KEY = 'TEST_ACCOUNT_B_NSEC';

function readEnv() {
  if (!existsSync(ENV_PATH)) return new Map();
  const lines = readFileSync(ENV_PATH, 'utf8').split('\n');
  const out = new Map();
  for (const line of lines) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) out.set(match[1], match[2]);
  }
  return out;
}

function writeEnv(map) {
  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const existingKeys = new Set();
  const lines = existing.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match && map.has(match[1])) {
      lines[i] = `${match[1]}=${map.get(match[1])}`;
      existingKeys.add(match[1]);
    }
  }
  for (const [k, v] of map) {
    if (!existingKeys.has(k)) lines.push(`${k}=${v}`);
  }
  writeFileSync(ENV_PATH, lines.filter((l, i, arr) => !(l === '' && i === arr.length - 1)).join('\n') + '\n');
}

function loadOrGenerateSenderKey() {
  const env = readEnv();
  const existing = env.get(ENV_KEY);
  if (existing) {
    const decoded = nip19.decode(existing);
    if (decoded.type !== 'nsec') throw new Error(`${ENV_KEY} is not an nsec`);
    console.log(`[B] Reusing sender nsec from ${ENV_PATH}`);
    return decoded.data;
  }
  const secretKey = generateSecretKey();
  const nsec = nip19.nsecEncode(secretKey);
  env.set(ENV_KEY, nsec);
  writeEnv(env);
  console.log(`[B] Generated fresh sender nsec, saved to ${ENV_PATH} as ${ENV_KEY}`);
  return secretKey;
}

function normaliseRecipient(input) {
  let hex = input.trim();
  if (hex.startsWith('nostr:')) hex = hex.slice(6);
  if (hex.startsWith('npub1')) {
    const decoded = nip19.decode(hex);
    if (decoded.type !== 'npub') throw new Error('Not an npub');
    return decoded.data;
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Invalid pubkey format');
  return hex.toLowerCase();
}

async function main() {
  const recipientArg = argv[2];
  const message = argv[3] ?? 'Hello from Account B via NIP-17';
  if (!recipientArg) {
    console.error('Usage: node send-nip17-from-test-account.mjs <recipient-npub-or-hex> [message]');
    exit(1);
  }
  const recipientPubkey = normaliseRecipient(recipientArg);
  const senderSecretKey = loadOrGenerateSenderKey();
  const senderPubkey = getPublicKey(senderSecretKey);
  console.log(`[B] sender pubkey: ${senderPubkey}`);
  console.log(`[B] sender npub:   ${nip19.npubEncode(senderPubkey)}`);
  console.log(`[A] recipient:     ${recipientPubkey}`);

  const pool = new SimplePool();

  // Profile (kind 0) — distinct name + visible avatar + banner so we
  // can tell this contact apart from real followings at a glance.
  const profile = finalizeEvent(
    {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({
        name: 'Little Piggy',
        display_name: 'Little Piggy',
        about: 'Test account used to verify NIP-17 unwrap on Amber.',
        picture:
          'https://raw.githubusercontent.com/BenGWeeks/lightning-piggy-mobile/claude/pr-issue-112-b1og0/assets/images/test-account-b-avatar.png',
        banner:
          'https://raw.githubusercontent.com/BenGWeeks/lightning-piggy-mobile/claude/pr-issue-112-b1og0/assets/images/test-account-b-avatar.png',
      }),
    },
    senderSecretKey,
  );

  // Contact list (kind 3) — following A so the recipient's Following-only
  // filter doesn't hide this message on arrival.
  const contacts = finalizeEvent(
    {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', recipientPubkey, '', '']],
      content: '',
    },
    senderSecretKey,
  );

  // NIP-17 gift wrap (kind 1059) → seal (13) → rumor (14).
  const wrap = nip17.wrapEvent(senderSecretKey, { publicKey: recipientPubkey }, message);

  console.log(`[B] publishing kind 0 ${profile.id}`);
  console.log(`[B] publishing kind 3 ${contacts.id}`);
  console.log(`[B] publishing kind 1059 ${wrap.id}`);

  await Promise.allSettled(pool.publish(RELAYS, profile));
  await Promise.allSettled(pool.publish(RELAYS, contacts));
  await Promise.allSettled(pool.publish(RELAYS, wrap));

  // Give relays a moment to propagate before closing the pool.
  await new Promise((r) => setTimeout(r, 1500));
  pool.close(RELAYS);

  console.log('\n[B] Done. The recipient should see this message in their inbox once they refresh.');
  console.log(`[B] Friend this account from the LP UI: ${nip19.npubEncode(senderPubkey)}`);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
