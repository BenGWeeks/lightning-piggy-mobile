// Marmot peer bot for LP end-to-end testing (Maestro flows 125/126).
// Signs in as a Piggy fixture (MAESTRO_NSEC_BOT, e.g. $MAESTRO_NSEC_LITTLE),
// publishes a Marmot key package, joins any Welcome it receives and replies
// "pong: <text>" to every message. Uses marmot-ts's own WebCrypto provider,
// so it also cross-checks LP's pure-JS Hermes crypto over the wire.
//   source .env && MAESTRO_NSEC_BOT=$MAESTRO_NSEC_LITTLE node --input-type=module < scripts/marmot-peer-bot.mjs
import { MarmotClient, createApplicationMessageIntent, createChatRumor, deserializeApplicationData } from '@internet-privacy/marmot-ts';
import { InMemoryKeyValueStore } from '@internet-privacy/marmot-ts/extra';
import { nip19, getPublicKey, finalizeEvent, nip44, matchFilters } from 'nostr-tools';
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
    return Object.fromEntries((relays.length ? relays : RELAYS).map((u, i) => [u, { from: u, ok: r[i].status === 'fulfilled' }]));
  },
  async request(relays, filters) {
    const out = [];
    for (const f of arr(filters)) out.push(...(await pool.querySync(relays.length ? relays : RELAYS, f, { maxWait: 6000 })));
    return out;
  },
  subscription(relays, filters) {
    return { subscribe(o) { const cs = arr(filters).map((f) => pool.subscribeMany(relays.length ? relays : RELAYS, f, { onevent: (e) => o.next?.(e) })); return { unsubscribe: () => cs.forEach((c) => c.close()) }; } };
  },
  async getUserInboxRelays() { return RELAYS; },
};
const signer = {
  getPublicKey: () => pk,
  signEvent: (d) => finalizeEvent(d, sk),
  nip44: { encrypt: (p, t) => nip44.encrypt(t, nip44.getConversationKey(sk, p)), decrypt: (p, c) => nip44.decrypt(c, nip44.getConversationKey(sk, p)) },
};
const client = new MarmotClient({ signer, network, groupStateStore: new InMemoryKeyValueStore(), keyPackageStore: new InMemoryKeyValueStore() });

const wire = (group) => {
  group.on('applicationMessage', async (data) => {
    const r = deserializeApplicationData(data);
    log(`RECV kind=${r.kind} from=${r.pubkey.slice(0, 8)} content=${JSON.stringify(r.content.slice(0, 120))} tags=${JSON.stringify(r.tags).slice(0, 160)}`);
    if (r.pubkey === pk) return;
    try {
      const reply = createChatRumor({ pubkey: pk, content: `pong: ${r.content.slice(0, 60)}` });
      await client.groups.send(group.id, createApplicationMessageIntent(reply));
      log('SENT reply', reply.id.slice(0, 8));
    } catch (e) {
      log('reply failed (relay?)', e?.message ?? e); // keep the bot alive mid-test
    }
  });
};
client.groups.on('joined', (g) => { log('JOINED group', g.idStr.slice(0, 8), 'name=', JSON.stringify(g.groupData?.name), 'members=', g.state ? 'ok' : '?'); wire(g); });
const kp = await client.keyPackages.create({ relays: RELAYS, identifier: bytesToHex(randomBytes(32)) });
log('bot pubkey', pk.slice(0, 12), 'key package published');
client.groups.connectAll({ fallbackRelays: RELAYS });

const since = Math.floor(Date.now() / 1000) - 3 * 24 * 3600; // NIP-59 randomises created_at back up to 2 days
pool.subscribeMany(RELAYS, { kinds: [1059], '#p': [pk], since }, {
  onevent: async (wrap) => {
    try {
      await client.invites.ingestEvent(wrap);
      await client.invites.decryptGiftWraps();
      for (const w of await client.invites.getUnread()) {
        log('WELCOME from', w.pubkey.slice(0, 8));
        try { await client.joinGroupFromWelcome({ welcomeRumor: w }); } catch (e) { log('join failed', e.message); }
        await client.invites.markAsRead(w.id);
      }
    } catch (e) { /* not a welcome for us */ }
  },
});
setTimeout(() => { log('bot timeout, exiting'); process.exit(0); }, Number(process.env.BOT_MINUTES ?? 15) * 60_000);
