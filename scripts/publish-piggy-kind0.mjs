#!/usr/bin/env node
// Publishes (or refreshes) the kind-0 profile metadata for each Piggy
// test-fixture identity, setting `picture` to the tinted piggy avatar
// hosted in this repo. Existing kind-0 fields (name, display_name,
// lud16, about, banner, nip05, etc.) are fetched from DEFAULT_RELAYS
// and merged so we don't clobber them.
//
// Usage:
//   node scripts/publish-piggy-kind0.mjs              # publish all four
//   node scripts/publish-piggy-kind0.mjs MAESTRO_NSEC # publish one
//   BRANCH=main node scripts/publish-piggy-kind0.mjs  # override raw URL branch
//
// Re-run this script whenever a Piggy's kind-0 picture needs refreshing
// (e.g. after the tinted PNGs change, or a relay drops the event).
//
// Never logs the nsec. Reads each MAESTRO_NSEC* from .env.

import { readFileSync, existsSync } from 'node:fs';
import { argv, exit, env } from 'node:process';
import { SimplePool } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';

// Mirror src/services/nostrService.ts → DEFAULT_RELAYS so we publish to
// the same relays the app reads from.
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const BRANCH = env.BRANCH || 'main';
const RAW_BASE = `https://raw.githubusercontent.com/BenGWeeks/lightning-piggy-mobile/${BRANCH}/tests/e2e/fixtures`;

// Each Piggy maps to (env var, fixture filename, friendly label). Label is
// only used for log lines — we never overwrite an existing `name` /
// `display_name` on the kind-0 if it's already published.
const PIGGIES = [
  // Mapping matches tests/e2e/README.adoc — note NSEC2=Little, NSEC3=Middle.
  { envVar: 'MAESTRO_NSEC', file: 'big-piggy-profile.png', label: 'Big Piggy' },
  { envVar: 'MAESTRO_NSEC2', file: 'little-piggy-profile.png', label: 'Little Piggy' },
  { envVar: 'MAESTRO_NSEC3', file: 'middle-piggy-profile.png', label: 'Middle Piggy' },
  { envVar: 'MAESTRO_NSEC4', file: 'evil-piggy-profile.png', label: 'Evil Piggy' },
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
  console.error(`Unknown env var: ${onlyEnvVar}. Expected one of ${PIGGIES.map((p) => p.envVar).join(', ')}.`);
  exit(1);
}

const pool = new SimplePool();

async function fetchExistingKind0(pubkey) {
  try {
    const events = await Promise.race([
      pool.querySync(RELAYS, { kinds: [0], authors: [pubkey], limit: 5 }),
      new Promise((resolve) => setTimeout(() => resolve([]), 8000)),
    ]);
    if (!events || events.length === 0) return null;
    events.sort((a, b) => b.created_at - a.created_at);
    return events[0];
  } catch (err) {
    console.warn(`  fetch failed: ${err?.message || err}`);
    return null;
  }
}

function parseContent(content) {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let exitCode = 0;

for (const piggy of targets) {
  const { envVar, file, label } = piggy;
  console.log(`\n=== ${label} (${envVar}) ===`);
  const nsec = nsecFor(envVar);
  if (!nsec) {
    console.error(`  ${envVar} not set in .env — skipping`);
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
    console.error(`  ${envVar} failed to decode: ${err?.message || err}`);
    exitCode = 1;
    continue;
  }
  console.log(`  pubkey: ${pubkey}`);
  console.log(`  npub:   ${nip19.npubEncode(pubkey)}`);

  const pictureUrl = `${RAW_BASE}/${file}`;
  console.log(`  picture: ${pictureUrl}`);

  const existing = await fetchExistingKind0(pubkey);
  const existingContent = existing ? parseContent(existing.content) : {};
  if (existing) {
    console.log(`  existing kind-0 found (created_at=${existing.created_at}, fields=${Object.keys(existingContent).join(',') || '(empty)'})`);
  } else {
    console.log('  no existing kind-0 — seeding name + display_name from label');
  }

  // Merge: keep everything, override picture, fill in name/display_name
  // only when the existing event has nothing there.
  const merged = { ...existingContent, picture: pictureUrl };
  if (!merged.name) merged.name = label;
  if (!merged.display_name) merged.display_name = label;

  const event = finalizeEvent(
    {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: existing?.tags || [],
      content: JSON.stringify(merged),
    },
    secretKey,
  );
  console.log(`  publishing kind-0 ${event.id}`);

  const results = await Promise.allSettled(pool.publish(RELAYS, event));
  let okCount = 0;
  for (let i = 0; i < RELAYS.length; i++) {
    const r = results[i];
    const ok = r.status === 'fulfilled';
    if (ok) okCount += 1;
    const detail = ok ? 'ok' : `failed: ${r.reason?.message || r.reason}`;
    console.log(`    ${RELAYS[i]} — ${detail}`);
  }
  if (okCount === 0) {
    console.error(`  ${label}: all relays rejected — flagging failure`);
    exitCode = 1;
  } else {
    console.log(`  ${label}: published to ${okCount}/${RELAYS.length} relays`);
  }
}

await new Promise((r) => setTimeout(r, 1500));
pool.close(RELAYS);
exit(exitCode);
