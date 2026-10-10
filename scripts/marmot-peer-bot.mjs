// Marmot peer bot for LP end-to-end testing (Maestro flows 125/126).
// Signs in as a Piggy fixture (MAESTRO_NSEC_BOT, e.g. $MAESTRO_NSEC_LITTLE),
// publishes a Marmot key package, joins any Welcome it receives and replies
// "pong: <text>" to every message. Uses marmot-ts's own WebCrypto provider,
// so it also cross-checks LP's pure-JS Hermes crypto over the wire.
//   source .env && MAESTRO_NSEC_BOT=$MAESTRO_NSEC_LITTLE node --input-type=module < scripts/marmot-peer-bot.mjs
// BOT_PUSH=1: also act as a MIP-05 sender — remember the push-token records
// members publish (kinds 447/449) and, after every message the bot sends,
// gift-wrap kind-446 triggers to their notification servers (as White Noise
// and Lightning Piggy do), so a closed app on the other side gets woken.
import {
  MarmotClient,
  createApplicationMessageIntent,
  createChatRumor,
  deserializeApplicationData,
  encodeMediaImetaTag,
  getGroupMembers,
  getMediaAttachments,
} from '@internet-privacy/marmot-ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  nip19,
  nip59,
  getPublicKey,
  finalizeEvent,
  generateSecretKey,
  nip44,
  matchFilters,
} from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { randomBytes, bytesToHex } from '@noble/hashes/utils.js';

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const nsec = process.env.MAESTRO_NSEC_BOT;
if (!nsec?.startsWith('nsec1')) {
  console.error('Set MAESTRO_NSEC_BOT to a Piggy fixture nsec (e.g. $MAESTRO_NSEC_LITTLE).');
  process.exit(1);
}
const decoded = nip19.decode(nsec);
if (decoded.type !== 'nsec') throw new Error('MAESTRO_NSEC_BOT is not an nsec');
const sk = decoded.data;
const pk = getPublicKey(sk);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const pool = new SimplePool();
const arr = (f) => (Array.isArray(f) ? f : [f]);
const network = {
  async publish(relays, ev) {
    const r = await Promise.allSettled(pool.publish(relays.length ? relays : RELAYS, ev));
    return Object.fromEntries(
      (relays.length ? relays : RELAYS).map((u, i) => [
        u,
        { from: u, ok: r[i].status === 'fulfilled' },
      ]),
    );
  },
  async request(relays, filters) {
    const out = [];
    for (const f of arr(filters))
      out.push(...(await pool.querySync(relays.length ? relays : RELAYS, f, { maxWait: 6000 })));
    return out;
  },
  subscription(relays, filters) {
    return {
      subscribe(o) {
        const cs = arr(filters).map((f) =>
          pool.subscribeMany(relays.length ? relays : RELAYS, f, {
            onevent: (e) => {
              if (process.env.BOT_DEBUG && e.kind === 445)
                log(
                  'EVT 445',
                  e.id.slice(0, 8),
                  'h=',
                  (e.tags.find((t) => t[0] === 'h') ?? [])[1]?.slice(0, 8),
                );
              o.next?.(e);
            },
          }),
        );
        return { unsubscribe: () => cs.forEach((c) => c.close()) };
      },
    };
  },
  async getUserInboxRelays() {
    return RELAYS;
  },
};
const signer = {
  getPublicKey: () => pk,
  signEvent: (d) => finalizeEvent(d, sk),
  nip44: {
    encrypt: (p, t) => nip44.encrypt(t, nip44.getConversationKey(sk, p)),
    decrypt: (p, c) => nip44.decrypt(c, nip44.getConversationKey(sk, p)),
  },
};
// Persistent per-identity MLS state, so a bot stays a member of the groups it
// joined in earlier runs (an in-memory bot is a brand-new client each start
// and can't read anything sent to its old groups). JSON with Uint8Array/bigint
// tagged — same codec as the app's src/services/marmotStore.ts.
const STATE_DIR = join(homedir(), '.cache', 'lp-marmot-bot', pk);
// BOT_RESET=1: forget all MLS state (as if reinstalled) — e.g. to make the bot
// send a brand-new invite instead of reusing an existing DM.
if (process.env.BOT_RESET) rmSync(STATE_DIR, { recursive: true, force: true });
mkdirSync(STATE_DIR, { recursive: true });
const encode = (v) =>
  JSON.stringify(v, function (k, val) {
    const raw = k === '' ? val : this[k];
    if (raw instanceof Uint8Array) return { $u8: Buffer.from(raw).toString('base64') };
    if (typeof raw === 'bigint') return { $bi: raw.toString() };
    return val;
  });
const decode = (s) =>
  JSON.parse(s, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === '$u8')
        return new Uint8Array(Buffer.from(v.$u8, 'base64'));
      if (keys.length === 1 && keys[0] === '$bi') return BigInt(v.$bi);
    }
    return v;
  });
function fileStore(ns) {
  const file = join(STATE_DIR, `${ns}.json`);
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const save = () => writeFileSync(file, JSON.stringify(data));
  return {
    getItem: async (k) => (k in data ? decode(data[k]) : null),
    setItem: async (k, v) => ((data[k] = encode(v)), save(), v),
    removeItem: async (k) => {
      delete data[k];
      save();
    },
    clear: async () => {
      for (const k of Object.keys(data)) delete data[k];
      save();
    },
    keys: async () => Object.keys(data),
  };
}
const meta = fileStore('meta');
const slot =
  (await meta.getItem('slot')) ?? (await meta.setItem('slot', bytesToHex(randomBytes(32))));
const client = new MarmotClient({
  signer,
  network,
  groupStateStore: fileStore('groups'),
  keyPackageStore: fileStore('keyPackages'),
  inviteStore: fileStore('invites'),
  ingestStateStore: fileStore('ingest'),
  lifecycleStore: fileStore('lifecycle'),
});

// --- BOT_PUSH: minimal MIP-05 sender (test tool — no owner-sig checks) ---
const pushStore = fileStore('push');
const recordKey = (e) => `${e.member_id_hex}|${e.leaf_index}|${e.platform}|${e.server_pubkey_hex}`;
async function ingestPush(group, r) {
  if (![447, 448, 449].includes(r.kind)) return false;
  let body;
  try {
    body = JSON.parse(r.content);
  } catch {
    return true;
  }
  const records = (await pushStore.getItem(group.idStr)) ?? {};
  for (const e of body.tokens ?? []) {
    const prev = records[recordKey(e)];
    if (!prev || e.owner_ts > prev.owner_ts) records[recordKey(e)] = e;
  }
  for (const e of body.removals ?? []) {
    const prev = records[recordKey(e)];
    if (prev && e.owner_ts > prev.owner_ts) delete records[recordKey(e)];
  }
  await pushStore.setItem(group.idStr, records);
  log(`PUSH records in ${group.idStr.slice(0, 8)}: ${Object.keys(records).length}`);
  return true;
}
async function triggerPush(group) {
  if (!process.env.BOT_PUSH) return;
  const records = Object.values((await pushStore.getItem(group.idStr)) ?? {}).filter(
    (e) => e.member_id_hex !== pk,
  );
  const byServer = new Map();
  for (const e of records) {
    const t = byServer.get(e.server_pubkey_hex) ?? { hints: new Set(), tokens: [] };
    t.tokens.push(e.encrypted_token);
    if (e.relay_hint) t.hints.add(e.relay_hint);
    byServer.set(e.server_pubkey_hex, t);
  }
  for (const [server, { hints, tokens }] of byServer) {
    let relays = [...hints];
    if (!relays.length) {
      const [inbox] = (
        await network.request(RELAYS, { kinds: [10050], authors: [server], limit: 1 })
      ).sort((a, b) => b.created_at - a.created_at);
      relays = inbox?.tags.filter((t) => t[0] === 'relay').map((t) => t[1]) ?? [];
    }
    const content = Buffer.concat(tokens.map((t) => Buffer.from(t, 'base64'))).toString('base64');
    const wrap = nip59.wrapEvent(
      { kind: 446, content, tags: [['v', 'marmot-push-v1']] },
      generateSecretKey(),
      server,
    );
    await Promise.allSettled(pool.publish(relays, wrap));
    log(`PUSH trigger → ${server.slice(0, 8)} (${tokens.length} token(s)) via ${relays.join(',')}`);
  }
}

const wire = (group) => {
  group.on('applicationMessage', async (data) => {
    const r = deserializeApplicationData(data);
    log(
      `RECV kind=${r.kind} from=${r.pubkey.slice(0, 8)} content=${JSON.stringify(r.content.slice(0, 120))} tags=${JSON.stringify(r.tags).slice(0, 160)}`,
    );
    if (r.pubkey === pk) return;
    if (await ingestPush(group, r)) return; // token gossip — never answered
    // Never answer another bot's pong (two bots in one group would loop).
    if (r.content.startsWith('pong: ')) return;
    // A photo (MIP-04): fetch + verify + decrypt it, as White Noise would.
    let mediaNote = '';
    for (const att of getMediaAttachments(r.tags)) {
      try {
        const { data } = await group.downloadMedia(att);
        log(
          `MEDIA OK v=${att.version} ${att.mediaType} ${att.filename} bytes=${data.length} sha=${bytesToHex(sha256(data)).slice(0, 12)}`,
        );
        mediaNote = '[photo ok]';
      } catch (e) {
        log(`MEDIA FAILED v=${att.version} ${att.mediaType}: ${e?.message ?? e}`);
        mediaNote = '[photo failed]';
      }
    }
    try {
      const reply = createChatRumor({
        pubkey: pk,
        content: `pong: ${mediaNote || r.content.slice(0, 60)}`,
      });
      await client.groups.send(group.id, createApplicationMessageIntent(reply));
      log('SENT reply', reply.id.slice(0, 8));
      await triggerPush(group);
    } catch (e) {
      log('reply failed (relay?)', e?.message ?? e); // keep the bot alive mid-test
    }
  });
};
client.groups.on('joined', (g) => {
  log(
    'JOINED group',
    g.idStr.slice(0, 8),
    'name=',
    JSON.stringify(g.groupData?.name),
    'members=',
    g.state ? 'ok' : '?',
  );
  wire(g);
});
for (const g of await client.groups.loadAll()) {
  log('LOADED group', g.idStr.slice(0, 8), 'name=', JSON.stringify(g.groupData?.name));
  wire(g);
}
await client.keyPackages.ensurePublished({ relays: RELAYS, identifier: slot });
log('bot pubkey', pk.slice(0, 12), 'key package published');
client.groups.connectAll({ fallbackRelays: RELAYS });

const since = Math.floor(Date.now() / 1000) - 3 * 24 * 3600; // NIP-59 randomises created_at back up to 2 days
pool.subscribeMany(
  RELAYS,
  { kinds: [1059], '#p': [pk], since },
  {
    onevent: async (wrap) => {
      try {
        await client.invites.ingestEvent(wrap);
        await client.invites.decryptGiftWraps();
        for (const w of await client.invites.getUnread()) {
          log('WELCOME from', w.pubkey.slice(0, 8));
          try {
            await client.joinGroupFromWelcome({ welcomeRumor: w });
            // The joined key package is spent: publish a fresh one in our slot.
            await client.keyPackages.ensurePublished({ relays: RELAYS, identifier: slot });
          } catch (e) {
            log('join failed', e.message);
          }
          await client.invites.markAsRead(w.id);
        }
      } catch (e) {
        /* not a welcome for us */
      }
    },
  },
);
// BOT_INITIATE_TO=<hex pubkey>: start a Marmot DM (White Noise shape: no
// name, both admins) to that account and send BOT_INITIATE_TEXT — exercises
// the app's invite-receive path (kind-444 Welcome → auto-join).
const hasDmWith = (target) =>
  client.groups.loaded.some((g) => {
    const members = getGroupMembers(g.state).map((m) => m.toLowerCase());
    return (g.groupData?.name ?? '') === '' && members.length === 2 && members.includes(target);
  });
const dmWith = (target) =>
  client.groups.loaded.find((g) => {
    const members = getGroupMembers(g.state).map((m) => m.toLowerCase());
    return (g.groupData?.name ?? '') === '' && members.length === 2 && members.includes(target);
  });
// BOT_INITIATE_DELAY_S: wait before saying hello — lets the group backfill
// (e.g. the other side's push-token records) land first.
await new Promise((r) => setTimeout(r, Number(process.env.BOT_INITIATE_DELAY_S ?? 0) * 1000));
if (process.env.BOT_INITIATE_TO && hasDmWith(process.env.BOT_INITIATE_TO.toLowerCase())) {
  // Say hello in the existing DM so the flow can wait for it (proves the app
  // is reading this group before it replies).
  const dm = dmWith(process.env.BOT_INITIATE_TO.toLowerCase());
  const text = process.env.BOT_INITIATE_TEXT ?? 'hello from the bot over MLS';
  try {
    await client.groups.send(
      dm.id,
      createApplicationMessageIntent(createChatRumor({ pubkey: pk, content: text })),
    );
    log('DM with target already exists — SENT hello in', dm.idStr.slice(0, 8));
    await triggerPush(dm);
  } catch (e) {
    log('hello in existing DM failed:', e?.message ?? e);
  }
} else if (process.env.BOT_INITIATE_TO) {
  const target = process.env.BOT_INITIATE_TO.toLowerCase();
  const text = process.env.BOT_INITIATE_TEXT ?? 'hello from the bot over MLS';
  try {
    // Their key package lives on their NIP-65 write relays; our RELAYS overlap the app's defaults.
    const [targetKp] = (
      await network.request(RELAYS, { kinds: [30443], authors: [target], limit: 10 })
    ).sort((a, b) => b.created_at - a.created_at);
    if (!targetKp) throw new Error('target has no key package yet (open the app first)');
    const group = await client.groups.create('', { relays: RELAYS, adminPubkeys: [pk, target] });
    wire(group);
    await client.groups.invite(group.id, targetKp);
    log('INITIATED DM to', target.slice(0, 8), 'group', group.idStr.slice(0, 8));
    await client.groups.send(
      group.id,
      createApplicationMessageIntent(createChatRumor({ pubkey: pk, content: text })),
    );
    log('SENT initiate text');
    await triggerPush(group);
  } catch (e) {
    log('initiate failed:', e?.message ?? e);
  }
}

// BOT_SEND_PHOTO=<file> (with BOT_INITIATE_TO): send that image into the DM
// the way White Noise does — encrypted-media-v2 on Blossom, kind 9 + imeta.
if (process.env.BOT_SEND_PHOTO && process.env.BOT_INITIATE_TO) {
  const dm = dmWith(process.env.BOT_INITIATE_TO.toLowerCase());
  try {
    if (!dm) throw new Error('no DM with the target');
    const bytes = readFileSync(process.env.BOT_SEND_PHOTO);
    const type = process.env.BOT_SEND_PHOTO.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const { attachment } = await dm.uploadMedia(
      new Blob([bytes], { type }),
      { filename: process.env.BOT_SEND_PHOTO.split('/').pop(), type },
      // White Noise's defaults: encrypted blobs need servers that accept
      // opaque octet-stream (media-only servers reject them).
      {
        servers: [
          'https://blossom.divine.video',
          'https://blossom.ditto.pub',
          'https://cdn.hzrd149.com',
        ],
      },
    );
    const rumor = createChatRumor({
      pubkey: pk,
      content: process.env.BOT_PHOTO_CAPTION ?? '',
      tags: [encodeMediaImetaTag(attachment)],
    });
    await client.groups.send(dm.id, createApplicationMessageIntent(rumor));
    log(`SENT photo v=${attachment.version} sha=${attachment.plaintextSha256.slice(0, 12)}`);
  } catch (e) {
    log('send photo failed:', e?.message ?? e);
  }
}

setTimeout(
  () => {
    log('bot timeout, exiting');
    process.exit(0);
  },
  Number(process.env.BOT_MINUTES ?? 15) * 60_000,
);
