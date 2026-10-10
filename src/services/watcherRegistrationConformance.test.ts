// Conformance: registrations built by the app (watcherRegistration.ts) must
// pass the WATCHER's own parser. The watcher is a separate repo, so its
// `unwrapRegistration` / `parseRegistration` / `normalizeRelayUrl` are
// vendored below, verbatim in logic, from
//   github.com/BenGWeeks/lightning-piggy-notifications @ 28b1776
//   src/registration.ts + src/relayUrl.ts (MIT)
// with two runtime swaps only: node:crypto's sha256 → @noble/hashes, and
// node:net's isIP → a regex. Re-sync this block if PROTOCOL.md changes.

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44';
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  verifyEvent,
  type NostrEvent,
} from 'nostr-tools/pure';
import { encrypt as nip44Encrypt } from 'nostr-tools/nip44';

import {
  buildRegistrationWrap,
  nextRegistrationTs,
  nwcProof,
  selectRegistrationRelays,
  type RegistrationBody,
  type SealSigner,
} from './watcherRegistration';

// ---------------------------------------------------------------------------
// Vendored watcher parser (see header).
// ---------------------------------------------------------------------------

const REGISTRATION_KIND = 8480;
const MAX_WRAP_CONTENT = 32_000;
const MAX_CONTENT_JSON = 8_192;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const APNS_TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;
const FCM_TOKEN_RE = /^[A-Za-z0-9_:\-.]{32,512}$/;
const LIMITS = {
  maxRelaysPerRegistration: 8,
  maxNwcPubkeysPerRegistration: 3,
  registrationMaxAgeSec: 6 * 3600,
  registrationMaxSkewSec: 120,
};
const CATEGORIES = ['dm', 'zap', 'mention', 'payment'] as const;
type Category = (typeof CATEGORIES)[number];

class RegistrationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}
function fail(reason: string): never {
  throw new RegistrationError(reason);
}

const isIP = (h: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':');
const BLOCKED_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.lan',
  '.home',
  '.onion',
  '.home.arpa',
];
function normalizeRelayUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 256) return null;
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'wss:') return null;
  if (u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return null;
  if (!host.includes('.')) return null;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) || host === 'localhost') return null;
  const port = u.port ? `:${u.port}` : '';
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${host}${port}${path}`;
}

function nwcProofMessage(user: string, wallet: string): Uint8Array {
  return sha256(utf8ToBytes(`lightning-piggy-watcher/nwc/v1:${user}:${wallet}`));
}

function isEventShape(x: unknown): x is NostrEvent {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.pubkey === 'string' &&
    typeof e.created_at === 'number' &&
    typeof e.kind === 'number' &&
    Array.isArray(e.tags) &&
    typeof e.content === 'string' &&
    typeof e.sig === 'string'
  );
}

function unwrapRegistration(wrap: NostrEvent, watcherSecretKey: Uint8Array) {
  if (wrap.kind !== 1059) fail('not a gift wrap');
  if (wrap.content.length > MAX_WRAP_CONTENT) fail('wrap too large');
  if (!HEX64.test(wrap.pubkey)) fail('bad wrap pubkey');
  let seal: unknown;
  try {
    seal = JSON.parse(
      nip44Decrypt(wrap.content, getConversationKey(watcherSecretKey, wrap.pubkey)),
    );
  } catch {
    fail('wrap decrypt failed');
  }
  if (!isEventShape(seal) || seal.kind !== 13) fail('bad seal');
  if (!HEX64.test(seal.pubkey) || !HEX128.test(seal.sig)) fail('bad seal fields');
  if (seal.tags.length !== 0) fail('seal must have no tags');
  if (seal.content.length > MAX_WRAP_CONTENT) fail('seal too large');
  if (!verifyEvent(seal)) fail('seal signature invalid');
  let rumor: unknown;
  try {
    rumor = JSON.parse(
      nip44Decrypt(seal.content, getConversationKey(watcherSecretKey, seal.pubkey)),
    );
  } catch {
    fail('seal decrypt failed');
  }
  const r = rumor as Record<string, unknown> | null;
  if (
    !r ||
    typeof r !== 'object' ||
    typeof r.id !== 'string' ||
    typeof r.pubkey !== 'string' ||
    typeof r.created_at !== 'number' ||
    typeof r.kind !== 'number' ||
    !Array.isArray(r.tags) ||
    typeof r.content !== 'string'
  ) {
    fail('bad rumor');
  }
  const rumorEv = r as unknown as NostrEvent;
  if (rumorEv.pubkey !== seal.pubkey) fail('rumor pubkey does not match seal signer');
  if (getEventHash(rumorEv) !== rumorEv.id) fail('rumor id mismatch');
  return { rumor: rumorEv, sealPubkey: seal.pubkey };
}

function parseRegistration(rumor: NostrEvent, opts: { apps: readonly string[]; nowSec: number }) {
  if (rumor.kind !== REGISTRATION_KIND) fail(`unexpected rumor kind ${rumor.kind}`);
  if (rumor.content.length > MAX_CONTENT_JSON) fail('content too large');
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(rumor.content) as Record<string, unknown>;
  } catch {
    fail('content is not JSON');
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) fail('content is not an object');
  if (c.v !== 1) fail('unsupported version');
  const action = c.action;
  if (action !== 'register' && action !== 'unregister') fail('bad action');
  if (typeof c.app !== 'string' || !opts.apps.includes(c.app)) fail('unknown app');
  const platform = c.platform;
  if (platform !== 'apns' && platform !== 'fcm') fail('bad platform');
  const rawToken = c.token;
  if (
    typeof rawToken !== 'string' ||
    !(platform === 'apns' ? APNS_TOKEN_RE : FCM_TOKEN_RE).test(rawToken)
  )
    fail('bad token');
  const token = platform === 'apns' ? rawToken.toLowerCase() : rawToken;
  const apnsEnv = c.apns_env;
  if (apnsEnv !== undefined && apnsEnv !== 'production' && apnsEnv !== 'sandbox')
    fail('bad apns_env');
  const ts = c.ts;
  if (typeof ts !== 'number' || !Number.isInteger(ts)) fail('bad ts');
  if (ts !== rumor.created_at) fail('ts must equal rumor created_at');
  if (ts < opts.nowSec - LIMITS.registrationMaxAgeSec) fail('registration too old');
  if (ts > opts.nowSec + LIMITS.registrationMaxSkewSec) fail('registration from the future');

  const categories: Record<Category, boolean> = {
    dm: false,
    zap: false,
    mention: false,
    payment: false,
  };
  const relays: string[] = [];
  const nwc: { client: string; wallet: string }[] = [];
  if (action === 'register') {
    const cats = c.categories;
    if (!cats || typeof cats !== 'object' || Array.isArray(cats)) fail('bad categories');
    for (const k of CATEGORIES) {
      const v = (cats as Record<string, unknown>)[k];
      if (v !== undefined && typeof v !== 'boolean') fail(`bad category ${k}`);
      categories[k] = v === true;
    }
    const rawRelays = c.relays ?? [];
    if (!Array.isArray(rawRelays)) fail('bad relays');
    if (rawRelays.length > LIMITS.maxRelaysPerRegistration * 2) fail('too many relays');
    for (const raw of rawRelays) {
      const n = normalizeRelayUrl(raw);
      if (n && !relays.includes(n)) relays.push(n);
    }
    if (relays.length > LIMITS.maxRelaysPerRegistration)
      relays.length = LIMITS.maxRelaysPerRegistration;
    const rawNwc = c.nwc ?? [];
    if (!Array.isArray(rawNwc) || rawNwc.length > LIMITS.maxNwcPubkeysPerRegistration)
      fail('bad nwc');
    for (const entry of rawNwc) {
      const e = entry as Record<string, unknown> | null;
      if (!e || typeof e !== 'object') fail('bad nwc entry');
      const { client, wallet, proof } = e;
      if (typeof client !== 'string' || !HEX64.test(client)) fail('bad nwc client pubkey');
      if (typeof wallet !== 'string' || !HEX64.test(wallet)) fail('bad nwc wallet pubkey');
      if (typeof proof !== 'string' || !HEX128.test(proof)) fail('bad nwc proof');
      if (client === rumor.pubkey) fail('nwc client pubkey must not be the user pubkey');
      let ok: boolean;
      try {
        ok = schnorr.verify(
          hexToBytes(proof),
          nwcProofMessage(rumor.pubkey, wallet),
          hexToBytes(client),
        );
      } catch {
        ok = false;
      }
      if (!ok) fail('nwc proof invalid');
      if (!nwc.some((n) => n.client === client && n.wallet === wallet))
        nwc.push({ client, wallet });
    }
  }
  return {
    user: rumor.pubkey,
    action,
    app: c.app,
    platform,
    token,
    categories,
    relays,
    nwc,
    ...(apnsEnv !== undefined ? { apnsEnv } : {}),
    ts,
  };
}

// ---------------------------------------------------------------------------
// The app's builder against it.
// ---------------------------------------------------------------------------

const watcherSk = generateSecretKey();
const watcherPk = getPublicKey(watcherSk);
const userSk = generateSecretKey();
const userPk = getPublicKey(userSk);
const APPS = [
  'com.lightningpiggy.app',
  'com.lightningpiggy.app.preview',
  'com.lightningpiggy.app.dev',
];
// The watcher's own test tokens (test/helpers.ts).
const FCM_TOKEN = 'fKq1:APA91bHPRgkF' + 'x'.repeat(120);
const APNS_TOKEN = 'a'.repeat(64);
const now = () => Math.floor(Date.now() / 1000);

/** An nsec seal signer — the same two operations Amber / NIP-46 perform. */
function localSigner(sk: Uint8Array = userSk): SealSigner & { calls: string[] } {
  const calls: string[] = [];
  return {
    pubkey: getPublicKey(sk),
    calls,
    async nip44Encrypt(peer, plaintext) {
      calls.push('nip44Encrypt');
      return nip44Encrypt(plaintext, getConversationKey(sk, peer));
    },
    async signEvent(template) {
      calls.push('signEvent');
      return finalizeEvent(template, sk);
    },
  };
}

const registerBody = (over: Partial<RegistrationBody> = {}): RegistrationBody =>
  ({
    action: 'register',
    app: 'com.lightningpiggy.app',
    platform: 'fcm',
    token: FCM_TOKEN,
    categories: { dm: true, zap: false, mention: true, payment: false },
    relays: ['wss://relay.example.com'],
    nwc: [],
    ...over,
  }) as RegistrationBody;

async function roundTrip(body: RegistrationBody, ts = now(), signer = localSigner()) {
  const wrap = await buildRegistrationWrap(signer, body, ts, watcherPk);
  const { rumor, sealPubkey } = unwrapRegistration(wrap, watcherSk);
  return {
    wrap,
    rumor,
    sealPubkey,
    parsed: parseRegistration(rumor, { apps: APPS, nowSec: now() }),
  };
}

describe('watcher conformance: app-built registrations pass the watcher parser', () => {
  it('a register round-trips with the user authenticated by the seal', async () => {
    const signer = localSigner();
    const ts = now();
    const { wrap, rumor, sealPubkey, parsed } = await roundTrip(registerBody(), ts, signer);
    expect(wrap.kind).toBe(1059);
    expect(wrap.tags).toEqual([['p', watcherPk]]);
    expect(wrap.pubkey).not.toBe(userPk); // throwaway wrap key
    expect(sealPubkey).toBe(userPk);
    expect(rumor.kind).toBe(8480);
    expect(rumor.created_at).toBe(ts);
    expect(parsed).toMatchObject({
      user: userPk,
      action: 'register',
      app: 'com.lightningpiggy.app',
      platform: 'fcm',
      token: FCM_TOKEN,
      categories: { dm: true, zap: false, mention: true, payment: false },
      relays: ['wss://relay.example.com'],
      ts,
    });
    // Exactly one encryption + one signature from the user's signer.
    expect(signer.calls).toEqual(['nip44Encrypt', 'signEvent']);
  });

  it('carries apns_env for iOS tokens', async () => {
    const { parsed } = await roundTrip(
      registerBody({ platform: 'apns', token: APNS_TOKEN, apns_env: 'sandbox' } as never),
    );
    expect(parsed).toMatchObject({ platform: 'apns', token: APNS_TOKEN, apnsEnv: 'sandbox' });
  });

  it('an unregister round-trips', async () => {
    const { parsed } = await roundTrip({
      action: 'unregister',
      app: 'com.lightningpiggy.app.preview',
      platform: 'fcm',
      token: FCM_TOKEN,
    });
    expect(parsed).toMatchObject({ action: 'unregister', app: 'com.lightningpiggy.app.preview' });
  });

  it('NWC proofs made by the app verify, and are bound to the user', async () => {
    const secret = bytesToHex(generateSecretKey());
    const wallet = getPublicKey(generateSecretKey());
    const entry = nwcProof(userPk, { wallet, secret });
    expect(entry.client).toBe(getPublicKey(hexToBytes(secret)));
    const { parsed } = await roundTrip(
      registerBody({
        categories: { dm: false, zap: false, mention: false, payment: true },
        nwc: [entry],
      } as never),
    );
    expect(parsed.nwc).toEqual([{ client: entry.client, wallet }]);
    // The same proof claimed by someone else's key is refused.
    const mallory = generateSecretKey();
    await expect(
      roundTrip(registerBody({ nwc: [entry] } as never), now(), localSigner(mallory)),
    ).rejects.toThrow('nwc proof invalid');
  });

  it('every relay the app selects survives the watcher normaliser', async () => {
    const relays = selectRegistrationRelays(
      { dm: true, zap: true, mention: true, payment: true },
      {
        nwc: ['wss://relay.getalby.com/v1', 'wss://nos.lol'],
        inbox: ['wss://inbox.example.com/', 'wss://10.0.0.1', 'ws://plain.example.com'],
        read: [
          'wss://user:pw@x.example.com',
          'wss://read.example.com?x=1',
          'wss://read.example.com',
        ],
      },
    );
    const { parsed } = await roundTrip(registerBody({ relays } as never));
    expect(parsed.relays).toEqual(relays);
  });

  it('the ts window: now passes, a stale or future ts is refused', async () => {
    await expect(roundTrip(registerBody(), now() - 7 * 3600)).rejects.toThrow(
      'registration too old',
    );
    await expect(roundTrip(registerBody(), now() + 3600)).rejects.toThrow(
      'registration from the future',
    );
  });

  it('successive registrations get strictly increasing ts the watcher accepts', async () => {
    // The watcher keeps newest-wins per (user, token): anything <= last is stale.
    let last = 0;
    let watermark = 0;
    for (let i = 0; i < 3; i++) {
      const ts = nextRegistrationTs(last, now())!;
      const { parsed } = await roundTrip(registerBody(), ts);
      expect(parsed.ts).toBeGreaterThan(watermark);
      watermark = parsed.ts;
      last = ts;
    }
  });

  it('the vendored parser still catches a forged seal (sanity)', async () => {
    const wrap = await buildRegistrationWrap(localSigner(), registerBody(), now(), watcherPk);
    // Re-wrap the victim's rumor under an attacker's seal.
    const { rumor } = unwrapRegistration(wrap, watcherSk);
    const attacker = generateSecretKey();
    const seal = finalizeEvent(
      {
        kind: 13,
        created_at: now(),
        tags: [],
        content: nip44Encrypt(JSON.stringify(rumor), getConversationKey(attacker, watcherPk)),
      },
      attacker,
    );
    const eph = generateSecretKey();
    const forged = finalizeEvent(
      {
        kind: 1059,
        created_at: now(),
        tags: [['p', watcherPk]],
        content: nip44Encrypt(JSON.stringify(seal), getConversationKey(eph, watcherPk)),
      },
      eph,
    );
    expect(() => unwrapRegistration(forged, watcherSk)).toThrow(
      'rumor pubkey does not match seal signer',
    );
  });
});
