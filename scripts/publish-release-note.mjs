#!/usr/bin/env node
// Network operations are deliberately restricted to GitHub Actions runners.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimplePool } from 'nostr-tools/pool';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';
import { getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { normalizeURL } from 'nostr-tools/utils';
import { decode, neventEncode } from 'nostr-tools/nip19';
import { BEN_PUBKEY } from './build-release-note.mjs';

const DISCOVERY = ['wss://purplepag.es', 'wss://relay.primal.net', 'wss://user.kindpag.es'];
const FALLBACK = ['wss://relay.primal.net', 'wss://relay.damus.io', 'wss://nos.lol'];
const SIGNING_TIMEOUT = 600_000;
export const MAX_RELAYS = 10;

function clientKey(value) {
  if (value.startsWith('nsec1')) {
    const decoded = decode(value);
    if (decoded.type !== 'nsec') throw new Error('Invalid client key.');
    return decoded.data;
  }
  if (!/^[a-f\d]{64}$/i.test(value)) throw new Error('Invalid client key.');
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

// Use exactly the pool's URL identity before scheduling publishes: aliases can
// otherwise overwrite the same relay's pending promise for the same event ID.
export function normalizeRelayTargets(urls) {
  const relays = new Set();
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash)
        continue;
      relays.add(normalizeURL(url.href));
      if (relays.size === MAX_RELAYS) break;
    } catch {
      // Ignore malformed relay URLs in public metadata.
    }
  }
  return [...relays];
}

export function selectWriteRelays(lists) {
  const latest = [...lists].sort(
    (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
  )[0];
  const targets = normalizeRelayTargets(
    (latest?.tags || []).flatMap(([name, value, mode]) =>
      name === 'r' && (!mode || mode === 'write') ? [value] : [],
    ),
  );
  return targets.length ? targets : normalizeRelayTargets(FALLBACK);
}

// SimplePool.publish can resolve connection failures as strings. Individual
// relay.publish calls resolve only on a positive OK.
export function publishToRelays(pool, targets, event) {
  return Promise.allSettled(
    normalizeRelayTargets(targets).map(async (url) => {
      const relay = await pool.ensureRelay(url, { connectionTimeout: 15_000 });
      relay.publishTimeout = 20_000;
      await relay.publish(event);
    }),
  );
}

export async function signAndPublish(
  unsigned,
  {
    signer,
    pool,
    secret,
    expectedPubkey = BEN_PUBKEY,
    timeoutMs = SIGNING_TIMEOUT,
    log = console.log,
  },
) {
  let timer;
  try {
    const expected = JSON.stringify(unsigned);
    if (unsigned.pubkey !== expectedPubkey || unsigned.kind !== 1) {
      throw new Error('Amber returned a different or invalid release event; publishing refused.');
    }
    log('Waiting up to 10 minutes for approval in Amber.');
    const signed = await Promise.race([
      (async () => {
        await signer.connect();
        if ((await signer.getPublicKey()) !== expectedPubkey) {
          throw new Error('Amber is connected to the wrong account.');
        }
        return signer.signEvent(unsigned);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error('Amber approval timed out after 10 minutes. Open Amber and re-run.')),
          timeoutMs,
        );
      }),
    ]);
    clearTimeout(timer);
    const original = JSON.parse(expected);
    if (
      signed.pubkey !== expectedPubkey ||
      signed.content !== original.content ||
      signed.kind !== original.kind ||
      signed.created_at !== original.created_at ||
      JSON.stringify(signed.tags) !== JSON.stringify(original.tags) ||
      !verifyEvent(JSON.parse(JSON.stringify(signed)))
    ) {
      throw new Error('Amber returned a different or invalid release event; publishing refused.');
    }
    const lists = await pool.querySync(
      DISCOVERY,
      { kinds: [10002], authors: [expectedPubkey], limit: 1 },
      { maxWait: 15_000 },
    );
    const targets = selectWriteRelays(lists);
    const results = await publishToRelays(pool, targets, signed);
    const accepted = [];
    results.forEach((result, i) => {
      // Never print relay-supplied error text.
      log(`${targets[i]}: ${result.status === 'fulfilled' ? 'OK' : 'fail'}`);
      if (result.status === 'fulfilled') accepted.push(targets[i]);
    });
    if (accepted.length < 2) throw new Error('Fewer than 2 relays accepted the release note.');
    return `https://njump.me/${neventEncode({ id: signed.id, author: expectedPubkey, relays: accepted.slice(0, 3) })}`;
  } finally {
    clearTimeout(timer);
    try {
      await signer.close();
    } catch {
      // Cleanup must continue even if the signer is already closed.
    } finally {
      pool.destroy();
      secret.fill(0);
    }
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_ENVIRONMENT) {
    throw new Error('Publishing is allowed only on a GitHub Actions runner.');
  }
  const uri = process.env.NOSTR_RELEASE_BUNKER_URI;
  const key = process.env.NOSTR_RELEASE_CLIENT_KEY;
  if (!uri || !key) {
    console.log('::notice::Nostr release note skipped: set both NOSTR_RELEASE secrets.');
    return;
  }
  // Library diagnostics can contain relay notices or signer auth URLs. Suppress
  // them and never print exception text received from a relay or remote signer.
  console.debug = () => {};
  console.warn = () => {};
  const secret = clientKey(key);
  if (getPublicKey(secret) === BEN_PUBKEY) throw new Error('Use a separate client key.');
  if (!uri.startsWith('bunker://')) throw new Error('Expected an Amber bunker URI.');
  const pointer = await parseBunkerInput(uri);
  if (!pointer?.relays.length) throw new Error('Invalid Amber bunker URI.');
  const unsigned = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const pool = new SimplePool();
  const signer = BunkerSigner.fromBunker(secret, pointer, {
    pool,
    onauth: () => console.log('::notice::Open Amber to approve the release connection/request.'),
  });
  const link = await signAndPublish(unsigned, { signer, pool, secret });
  fs.writeFileSync(process.argv[3], link + '\n');
  console.log(link);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    // Only our fixed messages are safe; library errors can include secrets.
    const safe = [
      'Publishing is allowed only on a GitHub Actions runner.',
      'Use a separate client key.',
      'Expected an Amber bunker URI.',
      'Invalid Amber bunker URI.',
      'Invalid client key.',
      'Amber is connected to the wrong account.',
      'Amber approval timed out after 10 minutes. Open Amber and re-run.',
      'Amber returned a different or invalid release event; publishing refused.',
      'Fewer than 2 relays accepted the release note.',
    ];
    console.error(
      `::error::${safe.includes(error.message) ? error.message : 'Nostr signing/publishing failed. Check the Amber connection and approvals, then re-run.'}`,
    );
    process.exit(1);
  });
