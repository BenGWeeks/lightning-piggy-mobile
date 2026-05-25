#!/usr/bin/env node
// NWC CLI helper for payment-notification E2E testing (issue #634 follow-up).
// Reads wallet NWC strings from .env by key. Usage:
//   node scripts/nwc-pay.mjs invoice <ENV_KEY> <sats>     → prints a bolt11
//   node scripts/nwc-pay.mjs pay     <ENV_KEY> <bolt11>   → pays it
//   node scripts/nwc-pay.mjs balance <ENV_KEY>            → prints balance (sats)
import WS from 'ws';
globalThis.WebSocket = WS;
import { NWCClient } from '@getalby/sdk';
import fs from 'fs';

const [, , cmd, key, arg] = process.argv;
const env = fs.readFileSync('.env', 'utf8');
const line = env.split('\n').find((l) => l.startsWith(`${key}=`));
if (!line) { console.error(`No ${key} in .env`); process.exit(1); }
const url = line.slice(`${key}=`.length).trim().replace(/^["']|["']$/g, '');
const client = new NWCClient({ nostrWalletConnectUrl: url });

try {
  if (cmd === 'invoice') {
    const inv = await client.makeInvoice({ amount: Number(arg) * 1000, description: 'LP E2E test' });
    console.log(inv.invoice);
  } else if (cmd === 'pay') {
    const res = await client.payInvoice({ invoice: arg });
    console.log('paid, preimage:', res.preimage);
  } else if (cmd === 'balance') {
    const b = await client.getBalance();
    console.log('balance sats:', Math.round((b.balance || 0) / 1000));
  } else if (cmd === 'lookup') {
    // arg is a bolt11 invoice; report whether the wallet considers it settled
    const tx = await client.lookupInvoice({ invoice: arg });
    const settled = !!tx.settled_at || tx.state === 'settled' || (tx.preimage && /[1-9a-f]/.test(tx.preimage));
    console.log('settled:', settled);
    console.log('state:', tx.state, '| settled_at:', tx.settled_at, '| amount_sats:', Math.round((tx.amount || 0) / 1000), '| preimage:', (tx.preimage || '').slice(0, 16));
  } else {
    console.error('unknown cmd'); process.exit(1);
  }
} catch (e) { console.error('ERROR:', e?.message || String(e)); process.exit(1); }
process.exit(0);
