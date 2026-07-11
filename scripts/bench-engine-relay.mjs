// Dev harness for the #1049 native-engine benchmark: a minimal in-memory
// NIP-01 relay that pre-seeds a synthetic kind-1059 gift-wrap backlog for a
// FIXED bench receiver key (a throwaway dev constant shared with
// src/utils/nativeEngineBench.ts — never a real account). The in-app bench
// (EXPO_PUBLIC_NATIVE_ENGINE_BENCH=1) then drains the same backlog through
// BOTH the JS SimplePool+unwrapWrapNsec path and the native engine, from an
// emulator via ws://10.0.2.2:<port>. NOT shipped — repro/bench tool, like
// send-bulk-dms.mjs (#751) but against a local relay so public relays never
// see synthetic spam and runs are reproducible.
//
//   node scripts/bench-engine-relay.mjs [port=4870] [count=200]
//
// Uses the repo's nostr-tools plus `ws` (present transitively) for the
// server socket — Node 22 ships a WebSocket client but not a server.
// ws is CJS (v7 via the RN toolchain) — default-import and use `Server`
// (the `WebSocketServer` alias only exists from ws v8).
import ws from 'ws';
const WebSocketServer = ws.Server;
import { hexToBytes } from '@noble/hashes/utils.js';
import { wrapEvent } from 'nostr-tools/nip17';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const PORT = Number(process.argv[2] || 4870);
const COUNT = Number(process.argv[3] || 200);

// Shared with src/utils/nativeEngineBench.ts. Bench-only key material.
const BENCH_RECEIVER_SK_HEX = '11'.repeat(32);
const receiverSk = hexToBytes(BENCH_RECEIVER_SK_HEX);
const receiverPk = getPublicKey(receiverSk);

console.log(`Seeding ${COUNT} NIP-17 wraps for bench receiver ${receiverPk.slice(0, 10)}…`);
const senderSk = generateSecretKey();
const events = [];
for (let i = 0; i < COUNT; i++) {
  events.push(wrapEvent(senderSk, { publicKey: receiverPk }, `engine-bench #${i + 1} 🐷`));
}
console.log(`done. serving on ws://0.0.0.0:${PORT} (emulator: ws://10.0.2.2:${PORT})`);

const matches = (filter, ev) => {
  if (Array.isArray(filter.kinds) && !filter.kinds.includes(ev.kind)) return false;
  const p = filter['#p'];
  if (Array.isArray(p)) {
    const tagged = ev.tags.some((t) => t[0] === 'p' && p.includes(t[1]));
    if (!tagged) return false;
  }
  return true;
};

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (socket, req) => {
  console.log(`conn from ${req.socket.remoteAddress}`);
  socket.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg[0] === 'REQ') {
      const subId = msg[1];
      const filters = msg.slice(2);
      const limit = Math.min(...filters.map((f) => f.limit ?? Infinity), events.length);
      const backlog = events.filter((ev) => filters.some((f) => matches(f, ev))).slice(0, limit);
      console.log(`REQ ${subId}: replaying ${backlog.length} events`);
      for (const ev of backlog) socket.send(JSON.stringify(['EVENT', subId, ev]));
      socket.send(JSON.stringify(['EOSE', subId]));
    } else if (msg[0] === 'EVENT') {
      socket.send(JSON.stringify(['OK', msg[1]?.id ?? '', true, '']));
    } else if (msg[0] === 'CLOSE') {
      socket.send(JSON.stringify(['CLOSED', msg[1], '']));
    }
  });
});
