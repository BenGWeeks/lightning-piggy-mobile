// Scripted Marmot sender for the interop suite (.maestro/interop/). Acts as
// ONE test Piggy on its own MLS device (state under
// ~/.cache/lp-interop-sender/<pubkey>) and drives a Marmot group or 1:1 from
// the command line, with no UI. Uses marmot-ts like the app does.
//
//   INTEROP_NSEC=$MAESTRO_NSEC_MIDDLE node scripts/interop/marmot-sender.mjs <command> [--flags]
//
// Commands (all take --state <run-dir>/sender.json, created by `create`):
//   create  --name <name> --invite <hex>[@<client substring>],...  [--dm]
//           New group (or, with --dm and one invitee, a White Noise-shaped 1:1:
//           no name, both admins). Invites each invitee's fresh key packages
//           whose `client` tag contains the substring (default: any) — one
//           per install, so it doubles as the multi-device check.
//   send    --tag <tag> [--only a,b,c]   Send the item set (items.mjs).
//   say     --text <text>                One chat message.
//   rename  --name <name>                Admin rename (group-profile commit).
//   admins  --set <hex>,<hex>            Replace the admin set (admin-policy commit).
//   listen  --seconds <n> [--expect <regex>]...
//           Print what other members send as JSON lines; exit 0 only when
//           every --expect regex matched some received text.
//   info                                 Name, epoch, members, admins.
//
// Never pays anything: the invoice item is an expired 21-sat test invoice.
// Relays: nos.lol, relay.primal.net, nostr.mom (never relay.damus.io — it
// bans the dev machine's IP for rate limits).
import {
  MarmotClient,
  Proposals,
  createApplicationMessageIntent,
  createInviteIntent,
  evaluateKeyPackageForGroup,
  deserializeApplicationData,
  encodeMediaImetaTag,
  getGroupMembers,
} from '@internet-privacy/marmot-ts';
import { finalizeEvent, getEventHash, getPublicKey, nip19, nip44 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { randomBytes, bytesToHex } from '@noble/hashes/utils.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemPlan, contactText } from './items.mjs';

const RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom'];
// Blossom servers White Noise uses for opaque encrypted blobs.
const MEDIA_SERVERS = [
  'https://blossom.divine.video',
  'https://blossom.ditto.pub',
  'https://cdn.hzrd149.com',
];
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', '.maestro', 'interop', 'fixtures');
const KEY_PACKAGE_MAX_AGE_S = 30 * 24 * 3600;

// ---- args ----------------------------------------------------------------
const [command, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith('--')) continue;
  const k = rest[i].slice(2);
  const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
  if (k === 'expect') (flags.expect ??= []).push(v);
  else flags[k] = v;
}
const die = (msg) => {
  console.error(`marmot-sender: ${msg}`);
  process.exit(2);
};
if (!command) die('missing command (create|send|say|rename|admins|listen|info)');
if (!flags.state) die('--state <file> is required');

const nsec = process.env.INTEROP_NSEC;
if (!nsec?.startsWith('nsec1')) die('set INTEROP_NSEC to a test Piggy nsec (never printed)');
let sk;
try {
  sk = nip19.decode(nsec).data;
} catch {
  die('INTEROP_NSEC is not a valid nsec'); // never echo the decoder's message: it contains the key
}
const pk = getPublicKey(sk);
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

// ---- network / signer / storage (same shape as scripts/marmot-peer-bot.mjs) --
const pool = new SimplePool();
const arr = (f) => (Array.isArray(f) ? f : [f]);
const relaysOrDefault = (relays) =>
  relays?.length ? relays.filter((r) => !r.includes('damus')) : RELAYS;
const network = {
  async publish(relays, ev) {
    const urls = relaysOrDefault(relays);
    const r = await Promise.allSettled(pool.publish(urls, ev));
    return Object.fromEntries(
      urls.map((u, i) => [u, { from: u, ok: r[i].status === 'fulfilled' }]),
    );
  },
  async request(relays, filters) {
    const out = [];
    for (const f of arr(filters))
      out.push(...(await pool.querySync(relaysOrDefault(relays), f, { maxWait: 6000 })));
    return out;
  },
  subscription(relays, filters) {
    return {
      subscribe(o) {
        const subs = arr(filters).map((f) =>
          pool.subscribeMany(relaysOrDefault(relays), f, { onevent: (e) => o.next?.(e) }),
        );
        return { unsubscribe: () => subs.forEach((s) => s.close()) };
      },
    };
  },
  // Welcomes go to the invitee's NIP-17 inbox (kind 10050), as the app does.
  async getUserInboxRelays(pubkey) {
    const [list] = (
      await pool.querySync(
        RELAYS,
        { kinds: [10050], authors: [pubkey], limit: 1 },
        { maxWait: 5000 },
      )
    ).sort((a, b) => b.created_at - a.created_at);
    const relays = (list?.tags ?? []).filter((t) => t[0] === 'relay').map((t) => t[1]);
    return relaysOrDefault(relays.length ? relays : RELAYS);
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
const STATE_DIR = join(homedir(), '.cache', 'lp-interop-sender', pk);
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
const client = new MarmotClient({
  signer,
  network,
  groupStateStore: fileStore('groups'),
  keyPackageStore: fileStore('keyPackages'),
  inviteStore: fileStore('invites'),
  ingestStateStore: fileStore('ingest'),
  lifecycleStore: fileStore('lifecycle'),
});

// ---- run state -----------------------------------------------------------
const loadRun = () =>
  existsSync(flags.state) ? JSON.parse(readFileSync(flags.state, 'utf8')) : {};
const saveRun = (s) => writeFileSync(flags.state, JSON.stringify(s, null, 2));
const run = loadRun();
const out = (obj) => console.log(JSON.stringify(obj));

/** marmot-ts 0.6.1-next adds an array-returning proposal action un-flattened
 * (see src/services/marmotProposals.ts) — split it into single proposals. */
const spread = (action, count) =>
  Array.from({ length: count }, (_, i) => async (ctx) => {
    const ps = await action(ctx);
    if (ps.length !== count) throw new Error('unexpected proposal count');
    return ps[i];
  });

function rumor(kind, content, tags = []) {
  const r = { kind, pubkey: pk, created_at: Math.floor(Date.now() / 1000), tags, content };
  return { ...r, id: getEventHash(r) };
}

async function openGroup() {
  if (!run.groupId) die('no group in --state; run `create` first');
  const loaded = await client.groups.loadAll();
  const group = loaded.find((g) => g.idStr === run.groupId);
  if (!group) die(`group ${run.groupId.slice(0, 8)} is not in this sender's MLS state`);
  return group;
}

/** Subscribe and give the group a moment to catch up on other members'
 * commits (a stale epoch would make our sends undecryptable for them). */
async function connectAndSettle(seconds = Number(flags.settle ?? 8)) {
  // Only this run's group: connecting every stored group would consume other
  // runs' messages without anything recording them.
  await client.groups.connect(run.groupId, { fallbackRelays: RELAYS });
  await new Promise((r) => setTimeout(r, seconds * 1000));
}

async function send(group, r) {
  const res = await client.groups.send(group.id, createApplicationMessageIntent(r));
  return { id: r.id, kind: r.kind, relays: res };
}

// ---- commands ------------------------------------------------------------
async function freshKeyPackages(target, clientFilter) {
  const since = Math.floor(Date.now() / 1000) - KEY_PACKAGE_MAX_AGE_S;
  const events = await network.request(RELAYS, {
    kinds: [30443],
    authors: [target],
    since,
    limit: 50,
  });
  // Newest event per slot first — an empty newest event means the slot was
  // retired, and an older copy from a lagging relay must not resurrect it.
  const bySlot = new Map();
  for (const e of events) {
    const slot = e.tags.find((t) => t[0] === 'd')?.[1] ?? e.id;
    const prev = bySlot.get(slot);
    if (!prev || e.created_at > prev.created_at) bySlot.set(slot, e);
  }
  return [...bySlot.values()].filter((e) => {
    if (!e.content) return false;
    const clientTag = e.tags.find((t) => t[0] === 'client')?.[1] ?? '';
    return !clientFilter || clientTag.toLowerCase().includes(clientFilter.toLowerCase());
  });
}

async function cmdCreate() {
  const invitees = (flags.invite ?? '').split(',').filter(Boolean);
  if (!invitees.length) die('--invite <hex>[@client],... is required');
  const dm = flags.dm === 'true';
  if (dm && invitees.length !== 1) die('--dm takes exactly one invitee');
  const targets = invitees.map((s) => {
    const [hex, filter] = s.split('@');
    return { hex: hex.toLowerCase(), filter };
  });
  const name = dm ? '' : (flags.name ?? 'Interop test');
  const admins = dm ? [pk, targets[0].hex] : [pk];
  const group = await client.groups.create(name, { relays: RELAYS, adminPubkeys: admins });
  // One commit adds every eligible device of every invitee (the app's
  // buildInviteBatch, src/services/marmotInvitees.ts): marmot-ts's
  // groups.invite() refuses a second leaf for someone already added.
  const extraProposals = [];
  const welcomeRecipients = [];
  const invited = [];
  for (const t of targets) {
    const kps = await freshKeyPackages(t.hex, t.filter);
    if (!kps.length) log(`no fresh key package for ${t.hex.slice(0, 8)} (${t.filter ?? 'any'})`);
    for (const kp of kps) {
      const verdict = evaluateKeyPackageForGroup(group.state, kp);
      if (!verdict.eligible) {
        log(
          `skip kp ${kp.id.slice(0, 8)} of ${t.hex.slice(0, 8)}: ${JSON.stringify(verdict.reasons)}`,
        );
        continue;
      }
      try {
        const intent = createInviteIntent({ keyPackageEvent: kp, actorPubkey: pk });
        extraProposals.push(...(intent.extraProposals ?? []));
        welcomeRecipients.push(...(intent.welcomeRecipients ?? []));
        invited.push({
          member: t.hex,
          keyPackage: kp.id,
          client: kp.tags.find((x) => x[0] === 'client')?.[1] ?? null,
        });
      } catch (e) {
        log(`skip kp ${kp.id.slice(0, 8)} of ${t.hex.slice(0, 8)}: ${e?.message ?? e}`);
      }
    }
  }
  const delivered = new Set();
  if (welcomeRecipients.length) {
    const results = await client.groups.send(group.id, {
      kind: 'commit',
      actorPubkey: pk,
      extraProposals,
      welcomeRecipients,
    });
    for (const r of Array.isArray(results) ? results : [results]) {
      if (r?.welcomeDelivery?.kind !== 'attempted') continue;
      for (const o of r.welcomeDelivery.outcomes) {
        if (o.kind === 'succeeded') delivered.add(o.recipient.pubkey.toLowerCase());
        else log(`Welcome to ${o.recipient.pubkey.slice(0, 8)} failed: ${o.error}`);
      }
    }
  }
  const unreached = targets.map((t) => t.hex).filter((h) => !delivered.has(h));
  Object.assign(run, { groupId: group.idStr, name, dm, sender: pk, invited, unreached, items: {} });
  saveRun(run);
  out({ ok: unreached.length === 0, groupId: group.idStr, name, invited, unreached });
  if (unreached.length) process.exit(1);
}

async function cmdSend() {
  const tag = flags.tag ?? die('--tag is required');
  const only = flags.only ? new Set(flags.only.split(',')) : null;
  const group = await openGroup();
  await connectAndSettle();
  run.items ??= {};
  const members = getGroupMembers(group.state).map((m) => m.toLowerCase());
  const contactTarget = members.find((m) => m !== pk) ?? pk;
  for (const item of itemPlan(tag)) {
    if (only && !only.has(item.key) && !only.has(item.key.split('.')[0])) continue;
    try {
      const target = item.ref ? run.items[item.ref]?.id : undefined;
      if (item.ref && !target) throw new Error(`needs ${item.ref} first`);
      let r;
      if (item.media) {
        const file = item.media === 'image' ? 'interop-image.png' : 'interop-voice.m4a';
        const type = item.media === 'image' ? 'image/png' : 'audio/mp4';
        const { attachment } = await group.uploadMedia(
          new Blob([readFileSync(join(FIXTURES, file))], { type }),
          { filename: file, type },
          { servers: MEDIA_SERVERS },
        );
        r = rumor(9, '', [encodeMediaImetaTag(attachment)]);
      } else if (item.key === 'contact') {
        const nprofile = nip19.nprofileEncode({
          pubkey: contactTarget,
          relays: RELAYS.slice(0, 2),
        });
        r = rumor(9, contactText(tag, 'Interop contact', nprofile));
      } else if (item.kind === 9 && target) {
        r = rumor(9, item.content, [['q', target]]);
      } else if (item.kind === 7) {
        const author = run.items[item.ref]?.author ?? pk;
        r = rumor(7, item.content, [
          ['e', target],
          ['p', author],
          ['k', '9'],
        ]);
      } else if (item.kind === 5) {
        r = rumor(5, '', [
          ['e', target],
          ['k', String(run.items[item.ref].kind)],
        ]);
      } else if (item.kind === 1009) {
        r = rumor(1009, item.content, [['e', target]]);
      } else {
        r = rumor(item.kind, item.content);
      }
      const res = await send(group, r);
      run.items[item.key] = { ...res, author: pk, at: r.created_at };
      saveRun(run);
      out({ item: item.key, ok: true, id: r.id.slice(0, 12) });
      await new Promise((ok) => setTimeout(ok, 600)); // keep relay order stable
    } catch (e) {
      out({ item: item.key, ok: false, error: String(e?.message ?? e) });
    }
  }
}

async function cmdSay() {
  const group = await openGroup();
  await connectAndSettle();
  const res = await send(group, rumor(9, flags.text ?? die('--text is required')));
  out({ ok: true, id: res.id.slice(0, 12) });
}

async function cmdCommit(proposals, label) {
  const group = await openGroup();
  await connectAndSettle();
  await client.groups.commit(group.id, { extraProposals: proposals });
  out({ ok: true, action: label });
}

async function cmdListen() {
  const group = await openGroup();
  const expects = (flags.expect ?? []).map((x) => ({ re: new RegExp(x), hit: false }));
  group.on('applicationMessage', (data) => {
    const r = deserializeApplicationData(data);
    if (r.pubkey === pk) return;
    for (const e of expects) if (e.re.test(r.content)) e.hit = true;
    out({
      from: r.pubkey.slice(0, 12),
      kind: r.kind,
      content: r.content.slice(0, 200),
      tags: r.tags,
    });
    if (expects.length && expects.every((e) => e.hit)) finish();
  });
  await client.groups.connect(group.id, { fallbackRelays: RELAYS });
  const finish = () => {
    out({
      done: true,
      matched: expects.filter((e) => e.hit).map((e) => e.re.source),
      missing: expects.filter((e) => !e.hit).map((e) => e.re.source),
    });
    process.exit(expects.every((e) => e.hit) ? 0 : 1);
  };
  setTimeout(finish, Number(flags.seconds ?? 60) * 1000);
  await new Promise(() => {});
}

async function cmdInfo() {
  const group = await openGroup();
  await connectAndSettle(Number(flags.settle ?? 4));
  out({
    groupId: group.idStr,
    name: group.groupData?.name ?? null,
    epoch: String(group.state.groupContext.epoch),
    members: getGroupMembers(group.state),
    admins: group.groupData?.adminPubkeys ?? [],
  });
}

const commands = {
  create: cmdCreate,
  send: cmdSend,
  say: cmdSay,
  rename: () =>
    cmdCommit(
      spread(Proposals.proposeUpdateMetadata({ name: flags.name ?? die('--name') }), 1),
      'rename',
    ),
  admins: () =>
    cmdCommit(
      spread(
        Proposals.proposeUpdateMetadata({ adminPubkeys: (flags.set ?? die('--set')).split(',') }),
        1,
      ),
      'admins',
    ),
  listen: cmdListen,
  info: cmdInfo,
};
if (!commands[command]) die(`unknown command ${command}`);
// Keep the identity's key-package slot stable across runs (one "device").
const meta = fileStore('meta');
if (!(await meta.getItem('slot'))) await meta.setItem('slot', bytesToHex(randomBytes(32)));
try {
  await commands[command]();
} catch (e) {
  out({ ok: false, error: String(e?.message ?? e) });
  process.exit(1);
}
if (command !== 'listen') process.exit(0);
