// Locate a swap's lockup output inside a raw Bitcoin transaction (leaf util —
// imported by BOTH boltzService and swapRecoveryService, so it lives here
// rather than either service to avoid an import cycle).
//
// Boltz v2 endpoints return only a transaction id + raw hex — no vout and no
// amount — so both the reverse-swap recovery claim and the submarine refund
// must parse the hex and find the output paying the expected lockup address.
// Matching on OUR recorded address (rather than trusting any reported index)
// also verifies the lockup actually pays the script we can spend.
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';

// Lockup addresses are taproot (bech32m); without an ECC lib registered,
// toOutputScript throws "No ECC Library provided". Idempotent.
bitcoin.initEccLib(ecc);

export function extractLockupFromTxHex(
  txHex: string,
  lockupAddress: string,
): { vout: number; amount: number } | null {
  try {
    const tx = bitcoin.Transaction.fromHex(txHex);
    const expectedScript = bitcoin.address.toOutputScript(lockupAddress);
    for (let i = 0; i < tx.outs.length; i++) {
      const script = tx.outs[i].script;
      if (
        script.length === expectedScript.length &&
        script.every((b, j) => b === expectedScript[j])
      ) {
        return { vout: i, amount: Number(tx.outs[i].value) };
      }
    }
    return null;
  } catch (e) {
    console.warn('[lockupTx] Failed to parse lockup tx hex:', e);
    return null;
  }
}
