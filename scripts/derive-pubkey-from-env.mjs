#!/usr/bin/env node
// Reads an nsec variable from .env and prints only its derived public
// pubkey (hex + npub). Never prints the secret. Used by the NIP-17 test
// pipeline so we don't need to paste the nsec on the command line.
//
// Usage: node scripts/derive-pubkey-from-env.mjs MAESTRO_NSEC

import { readFileSync, existsSync } from 'node:fs';
import { argv, exit } from 'node:process';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';

const envVar = argv[2];
if (!envVar) {
  console.error('Usage: node derive-pubkey-from-env.mjs <ENV_VAR_NAME>');
  exit(1);
}
if (!existsSync('.env')) {
  console.error('No .env file in cwd');
  exit(1);
}
const line = readFileSync('.env', 'utf8')
  .split('\n')
  .find((l) => l.startsWith(`${envVar}=`));
if (!line) {
  console.error(`${envVar} not set in .env`);
  exit(1);
}
const nsec = line.slice(envVar.length + 1);
const decoded = nip19.decode(nsec);
if (decoded.type !== 'nsec') {
  console.error(`${envVar} is not an nsec`);
  exit(1);
}
const pubkey = getPublicKey(decoded.data);
console.log(`hex:  ${pubkey}`);
console.log(`npub: ${nip19.npubEncode(pubkey)}`);
