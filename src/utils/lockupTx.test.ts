import * as bitcoin from 'bitcoinjs-lib';
import { extractLockupFromTxHex } from './lockupTx';

// A stable P2WPKH pair (throwaway hash160s — never keyed to anything real).
const LOCKUP_ADDR = bitcoin.payments.p2wpkh({
  hash: Buffer.alloc(20, 7),
}).address as string;
const OTHER_ADDR = bitcoin.payments.p2wpkh({
  hash: Buffer.alloc(20, 9),
}).address as string;

// Build a raw tx whose SECOND output pays the lockup address — the exact
// shape that broke the old `data.index ?? 0` vout guess.
function buildTxHex(): string {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32, 1), 0);
  tx.addOutput(bitcoin.address.toOutputScript(OTHER_ADDR), BigInt(1_000));
  tx.addOutput(bitcoin.address.toOutputScript(LOCKUP_ADDR), BigInt(82_405));
  return tx.toHex();
}

describe('extractLockupFromTxHex', () => {
  it('finds the vout + amount paying the lockup address (not output 0)', () => {
    const hex = buildTxHex();
    expect(extractLockupFromTxHex(hex, LOCKUP_ADDR)).toEqual({
      txId: bitcoin.Transaction.fromHex(hex).getId(),
      vout: 1,
      amount: 82_405,
    });
  });

  it('derives the txid from the raw tx itself', () => {
    const lockup = extractLockupFromTxHex(buildTxHex(), LOCKUP_ADDR)!;
    // Display-order hex of the double-SHA256 of the serialized tx.
    const hash = bitcoin.crypto.hash256(Buffer.from(buildTxHex(), 'hex'));
    expect(lockup.txId).toBe(Buffer.from(hash).reverse().toString('hex'));
  });

  it('returns null when no output pays the address, or on garbage hex', () => {
    const unrelated = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 3) }).address as string;
    expect(extractLockupFromTxHex(buildTxHex(), unrelated)).toBeNull();
    expect(extractLockupFromTxHex('deadbeef', LOCKUP_ADDR)).toBeNull();
  });
});
