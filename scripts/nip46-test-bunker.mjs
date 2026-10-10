// Local NIP-46 ("Nostr Connect") test bunker for Lightning Piggy's signer-matrix
// E2E flows. Holds ONE Piggy fixture key (Little Piggy by default) and answers
// LP's kind-24133 requests on the same relay LP pairs over
// (NostrLoginSheet's NIP46_DEFAULT_RELAY = wss://relay.nsec.app).
//
// Don't run this directly — use the wrapper, which reads the nsec from .env
// and pipes it in on stdin (never argv, never the environment, never a log):
//   bash scripts/nip46-test-bunker.sh start
//
// Why not `nak bunker`? nak (v0.21) handles the client-initiated
// `nostrconnect://` flow, but it either answers every request from an
// authorised client or prompts on its TTY — there's no scripted way to DECLINE
// or IGNORE one method (e.g. sign_event) while still serving the session, which
// is exactly what the DECLINE / TIMEOUT flows need.
//
// Behaviour per request is driven by the current MODE:
//   approve      answer everything (default)
//   decline      answer session methods + decrypts, but reply with an error to
//                sign_event / nip04_encrypt / nip44_encrypt
//   silent       same split, but never reply to those methods (the app's
//                request just waits — the TIMEOUT case)
//   decline-all  / silent-all — as above, for every method except connect/ping
// The session handshake (connect, ping, get_public_key, switch_relays) is
// always answered, in every mode, so an already-paired session stays alive;
// the "-all" modes additionally refuse/ignore decrypts and new pairings.
//
// Control: a tiny HTTP API on 127.0.0.1 (default port 8746) so Maestro flows
// can flip the mode mid-flow via `runScript` (see .maestro/common/nip46-bunker.js).
// Every call needs `Authorization: Bearer <token>`; the token is random per
// bunker start and lives only in <state dir>/token (0600). Requests carrying a
// browser `Origin` header are refused.
//   GET  /status                 → { mode, clients, counts, pk }
//   GET  /status?wait=COUNTER&min=N&timeout=S → waits (≤ S s) until
//                                  counts[COUNTER] ≥ N, then 200 or 408
//   POST /mode        body=MODE  → set the mode
//   POST /pair        body=URI   → answer a nostrconnect:// pairing URI
//   POST /pair-from-screen       → screencap NIP46_DEVICE, decode LP's pairing
//                                  QR, answer it (body: optional seconds to keep
//                                  retrying while the QR renders, default 20)
//   POST /stats/reset            → zero the per-method request counters
//
// Only clients this bunker has paired with (persisted in the state dir) are
// answered; anything else is logged and ignored. Logs carry method names,
// event kinds and 8-char pubkey prefixes only — never plaintexts, ciphertexts,
// the pairing secret or the key.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { nip19, getPublicKey, finalizeEvent, nip04, nip44, verifyEvent } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';

const require = createRequire(import.meta.url);
const KIND = 24133;
const STATE_DIR = process.env.NIP46_STATE_DIR;
const PORT = Number(process.env.NIP46_PORT || 8746);
const DEVICE = process.env.NIP46_DEVICE || 'emulator-5554';
const RELAYS = (process.env.NIP46_RELAYS || 'wss://relay.nsec.app')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);
// Pairing URIs may only name relays from this list (plus NIP46_RELAYS), so a
// caller can't make the bunker connect to arbitrary hosts.
const RELAY_ALLOWLIST = new Set([
  ...RELAYS,
  'wss://relay.nsec.app',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://offchain.pub',
]);
const MODES = ['approve', 'decline', 'silent', 'decline-all', 'silent-all'];
const SESSION_METHODS = new Set(['connect', 'ping', 'get_public_key', 'switch_relays']);
const GATED_METHODS = new Set(['sign_event', 'nip04_encrypt', 'nip44_encrypt']);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const short = (hex) => (hex || '').slice(0, 8);

if (!STATE_DIR) {
  console.error('NIP46_STATE_DIR not set — start via scripts/nip46-test-bunker.sh');
  process.exit(2);
}
mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });

// --- key: first line of stdin, then forget the raw string ---------------
const nsecLine = readFileSync(0, 'utf8').split('\n')[0].trim();
let sk;
try {
  const d = nip19.decode(nsecLine);
  if (d.type !== 'nsec') throw new Error('not an nsec');
  sk = d.data;
} catch {
  console.error('stdin did not contain a valid nsec');
  process.exit(2);
}
const pk = getPublicKey(sk);

// --- persistent state -----------------------------------------------------
const modeFile = join(STATE_DIR, 'mode');
const clientsFile = join(STATE_DIR, `clients-${short(pk)}.json`);
const readMode = () => {
  const m = existsSync(modeFile) ? readFileSync(modeFile, 'utf8').trim() : 'approve';
  return MODES.includes(m) ? m : 'approve';
};
const setMode = (m) => writeFileSync(modeFile, m + '\n', { mode: 0o600 });
// client pubkey -> relays it paired over (the app listens there for replies).
const clients = new Map(
  existsSync(clientsFile) ? Object.entries(JSON.parse(readFileSync(clientsFile, 'utf8'))) : [],
);
const saveClients = () =>
  writeFileSync(clientsFile, JSON.stringify(Object.fromEntries(clients)), { mode: 0o600 });
const counts = {};
const bump = (k) => (counts[k] = (counts[k] || 0) + 1);

// --- crypto helpers (reply with whatever scheme the request used) ---------
const convKeys = new Map();
const convKey = (peer) => {
  if (!convKeys.has(peer)) convKeys.set(peer, nip44.getConversationKey(sk, peer));
  return convKeys.get(peer);
};
function openRequest(ev) {
  try {
    return { scheme: 'nip44', body: JSON.parse(nip44.decrypt(ev.content, convKey(ev.pubkey))) };
  } catch {
    return { scheme: 'nip04', body: JSON.parse(nip04.decrypt(sk, ev.pubkey, ev.content)) };
  }
}
const seal = (scheme, peer, obj) =>
  scheme === 'nip44'
    ? nip44.encrypt(JSON.stringify(obj), convKey(peer))
    : nip04.encrypt(sk, peer, JSON.stringify(obj));

const pool = new SimplePool();
async function publish(relays, ev) {
  const res = await Promise.allSettled(pool.publish(relays, ev));
  // nostr-tools resolves (not rejects) with "connection failure: …" when a
  // relay is unreachable — only count real acceptances.
  return res.filter(
    (r) => r.status === 'fulfilled' && !String(r.value).startsWith('connection failure'),
  ).length;
}
async function reply(peer, scheme, payload, relays = clients.get(peer) ?? RELAYS) {
  const ev = finalizeEvent(
    {
      kind: KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', peer]],
      content: seal(scheme, peer, payload),
    },
    sk,
  );
  return publish(relays, ev);
}

// --- request handling -----------------------------------------------------
function perform(method, params) {
  switch (method) {
    case 'connect':
      return 'ack';
    case 'ping':
      return 'pong';
    case 'get_public_key':
      return pk;
    case 'switch_relays':
      // nostr-tools: "null" → keep the current relays.
      return 'null';
    case 'sign_event': {
      const t = JSON.parse(params[0]);
      return JSON.stringify(
        finalizeEvent(
          { kind: t.kind, created_at: t.created_at, tags: t.tags ?? [], content: t.content ?? '' },
          sk,
        ),
      );
    }
    case 'nip04_encrypt':
      return nip04.encrypt(sk, params[0], params[1]);
    case 'nip04_decrypt':
      return nip04.decrypt(sk, params[0], params[1]);
    case 'nip44_encrypt':
      return nip44.encrypt(params[1], nip44.getConversationKey(sk, params[0]));
    case 'nip44_decrypt':
      return nip44.decrypt(params[1], nip44.getConversationKey(sk, params[0]));
    default:
      throw new Error(`unsupported method ${method}`);
  }
}

function decide(method, mode) {
  if (mode === 'approve' || SESSION_METHODS.has(method)) return 'approve';
  if (!mode.endsWith('-all') && !GATED_METHODS.has(method)) return 'approve';
  return mode.startsWith('decline') ? 'decline' : 'silent';
}

const seen = new Set();
async function onRequest(ev) {
  if (seen.has(ev.id)) return;
  seen.add(ev.id);
  if (!verifyEvent(ev)) return;
  if (!clients.has(ev.pubkey)) {
    log(`IGNORED request from unpaired client=${short(ev.pubkey)}`);
    return;
  }
  let scheme, body;
  try {
    ({ scheme, body } = openRequest(ev));
  } catch {
    log(`UNREADABLE request from client=${short(ev.pubkey)}`);
    return;
  }
  const { id, method, params = [] } = body;
  let detail = '';
  if (method === 'sign_event') {
    try {
      detail = ` kind=${JSON.parse(params[0]).kind}`;
    } catch {
      /* keep detail empty */
    }
  }
  const mode = readMode();
  const verdict = decide(method, mode);
  bump(method);
  if (method === 'sign_event' && detail) bump(`sign_event${detail.replace(' ', ':')}`);
  bump(`verdict:${verdict}`);
  log(`REQ ${method}${detail} client=${short(ev.pubkey)} mode=${mode} -> ${verdict}`);
  if (verdict === 'silent') return;
  let payload;
  if (verdict === 'decline') {
    payload = { id, result: '', error: `Permission denied: user rejected ${method}` };
  } else {
    try {
      payload = { id, result: perform(method, params) };
    } catch (e) {
      payload = { id, result: '', error: String(e?.message ?? e) };
    }
  }
  const ok = await reply(ev.pubkey, scheme, payload);
  if (!ok) log(`!! reply to ${method} not accepted by any relay`);
}

// --- pairing (client-initiated nostrconnect:// flow) ----------------------
function parsePairingUri(uri) {
  const u = new URL(uri.trim());
  if (u.protocol !== 'nostrconnect:') throw new Error('not a nostrconnect:// URI');
  const client = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(client)) throw new Error('bad client pubkey in URI');
  const secret = u.searchParams.get('secret');
  if (!secret) throw new Error('URI has no secret');
  const relays = u.searchParams.getAll('relay').map((r) => r.replace(/\/+$/, ''));
  const bad = relays.filter((r) => !RELAY_ALLOWLIST.has(r));
  if (bad.length) throw new Error(`pairing relay not in the allowlist: ${bad.join(',')}`);
  return { client, secret, relays: relays.length ? relays : RELAYS };
}

async function pair(uri) {
  const { client, secret, relays } = parsePairingUri(uri);
  const mode = readMode();
  // A pairing ack is the `connect` response; in a decline/silent "-all" mode we
  // refuse it (LP ignores error replies here, so both end in its 120 s timeout).
  if (mode === 'silent-all') {
    log(`PAIR client=${short(client)} mode=${mode} -> silent`);
    return { paired: false, client: short(client), verdict: 'silent' };
  }
  const id = bytesToHex(randomBytes(8));
  const payload =
    mode === 'decline-all'
      ? { id, result: '', error: 'Permission denied: user rejected connect' }
      : { id, result: secret };
  const allRelays = [...new Set([...relays, ...RELAYS])];
  // Listen where the client will send its requests, and authorise it, BEFORE
  // acking: nostr-tools' client fires switch_relays/get_public_key the moment
  // the ack lands. Roll back if no relay takes the ack.
  await ensureSubscribed(allRelays);
  const accept = mode !== 'decline-all';
  if (accept) {
    clients.set(client, allRelays);
    saveClients();
  }
  const ok = await reply(client, 'nip44', payload, allRelays);
  if (!ok && accept) {
    clients.delete(client);
    saveClients();
  }
  const verdict = accept ? 'approve' : 'decline';
  log(`PAIR client=${short(client)} relays=${allRelays.length} accepted_by=${ok} -> ${verdict}`);
  if (!ok) throw new Error('no relay accepted the pairing reply');
  return { paired: verdict === 'approve', client: short(client), verdict };
}

let zxing;
async function decodeQr(png) {
  if (!zxing) {
    zxing = await import('zxing-wasm/reader');
    const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
    zxing.prepareZXingModule({
      overrides: {
        wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
      },
      fireImmediately: true,
    });
  }
  const res = await zxing.readBarcodes(new Uint8Array(png), { formats: ['QRCode'] });
  return res.map((r) => r.text).find((t) => t.startsWith('nostrconnect://')) ?? null;
}

async function pairFromScreen(waitSeconds) {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    // In-memory only: the screenshot contains the pairing secret.
    const png = execFileSync('adb', ['-s', DEVICE, 'exec-out', 'screencap', '-p'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const uri = await decodeQr(png);
    if (uri) return pair(uri);
    if (Date.now() > deadline) throw new Error(`no nostrconnect QR on ${DEVICE} screen`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// --- relay subscriptions ---------------------------------------------------
// The configured relays plus every relay a paired client named in its
// nostrconnect:// URI — so the bunker follows LP if its pairing relay changes.
const subscribed = new Set();
async function ensureSubscribed(relays) {
  const fresh = relays.filter((r) => !subscribed.has(r));
  if (!fresh.length) return;
  fresh.forEach((r) => subscribed.add(r));
  pool.subscribeMany(
    fresh,
    { kinds: [KIND], '#p': [pk], since: Math.floor(Date.now() / 1000) - 10 },
    { onevent: (ev) => void onRequest(ev).catch((e) => log('!! handler error', e?.message)) },
  );
  log(`LISTEN ${fresh.join(',')}`);
}
await ensureSubscribed([...new Set([...RELAYS, ...[...clients.values()].flat()])]);

// --- control API (localhost only, token-authenticated) ---------------------
const token = bytesToHex(randomBytes(24));
writeFileSync(join(STATE_DIR, 'token'), token + '\n', { mode: 0o600 });
const authorised = (req) => {
  const got = Buffer.from(String(req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
};
const waitForCount = async (counter, min, seconds) => {
  const deadline = Date.now() + seconds * 1000;
  while ((counts[counter] || 0) < min) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
  return true;
};
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 8192) req.destroy();
  });
  req.on('end', async () => {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    try {
      if (req.headers.origin) return send(403, { error: 'browser requests refused' });
      if (!authorised(req)) return send(401, { error: 'missing or wrong token' });
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/status') {
        const wait = url.searchParams.get('wait');
        if (wait) {
          const okWait = await waitForCount(
            wait,
            Number(url.searchParams.get('min') || 1),
            Math.min(Number(url.searchParams.get('timeout') || 20), 120),
          );
          if (!okWait) return send(408, { error: `timed out waiting for ${wait}`, counts });
        }
        return send(200, {
          pk,
          device: DEVICE,
          mode: readMode(),
          clients: clients.size,
          relays: [...subscribed],
          counts,
        });
      }
      if (req.method !== 'POST') return send(405, { error: 'POST only' });
      if (path === '/mode') {
        const m = body.trim();
        if (!MODES.includes(m)) return send(400, { error: `mode must be one of ${MODES}` });
        setMode(m);
        log(`MODE -> ${m}`);
        return send(200, { mode: m });
      }
      if (path === '/pair') return send(200, await pair(body));
      if (path === '/pair-from-screen')
        return send(200, await pairFromScreen(Number(body.trim()) || 20));
      if (path === '/stats/reset') {
        for (const k of Object.keys(counts)) delete counts[k];
        return send(200, { counts });
      }
      return send(404, { error: 'unknown endpoint' });
    } catch (e) {
      return send(500, { error: String(e?.message ?? e) });
    }
  });
});
server.listen(PORT, '127.0.0.1', () => {
  if (!existsSync(modeFile)) setMode('approve');
  log(`READY pk=${short(pk)} relays=${RELAYS.join(',')} port=${PORT} device=${DEVICE}`);
});

const shutdown = () => {
  log('STOP');
  server.close();
  pool.close([...subscribed]);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
