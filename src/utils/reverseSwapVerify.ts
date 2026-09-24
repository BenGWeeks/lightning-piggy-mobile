import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { keyAggregate, keyAggExport } from '@scure/btc-signer/musig2.js';
import { extractLockupFromTxHex } from './lockupTx';

bitcoin.initEccLib(ecc);

export const REVERSE_CLAIM_VBYTES = 180;
export const REVERSE_CREATE_MARGIN = 72;
export const REVERSE_CLAIM_MARGIN = 36;

export interface VerifiedReverseSwap {
  id: string;
  invoice: string;
  onchainAmount: number;
  timeoutBlockHeight: number;
  lockupAddress: string;
  refundPublicKey: string;
  swapTree: {
    claimLeaf: { version: number; output: string };
    refundLeaf: { version: number; output: string };
  };
}

/** Rebuild the canonical Boltz v2 reverse tree before paying or revealing a preimage.
 * Template: boltz-core/lib/swap/ReverseSwapTree.ts. The operator key comes first
 * in MuSig aggregation. This does not establish lockup confirmation/finality.
 */
export function verifyReverseSwap(
  raw: unknown,
  input: {
    preimageHash: Uint8Array;
    claimPublicKey: Uint8Array;
    expectedAmount: number;
    currentBlockHeight: number;
    minClaimBlocks?: number;
    claimFeeSats?: number;
  },
): asserts raw is VerifiedReverseSwap {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid reverse swap response');
  const swap = raw as VerifiedReverseSwap;
  if (typeof swap.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(swap.id))
    throw new Error('Invalid reverse swap id');
  if (
    !Number.isSafeInteger(input.expectedAmount) ||
    input.expectedAmount <= 546 + (input.claimFeeSats ?? REVERSE_CLAIM_VBYTES * 2) ||
    swap.onchainAmount !== input.expectedAmount
  )
    throw new Error('Reverse swap amount does not match the quote');
  if (
    !Number.isSafeInteger(input.currentBlockHeight) ||
    input.currentBlockHeight <= 0 ||
    !Number.isSafeInteger(swap.timeoutBlockHeight) ||
    swap.timeoutBlockHeight <
      input.currentBlockHeight + (input.minClaimBlocks ?? REVERSE_CREATE_MARGIN) ||
    swap.timeoutBlockHeight >= 500_000_000 ||
    swap.timeoutBlockHeight > input.currentBlockHeight + 1014
  )
    throw new Error('Reverse swap refund timeout is outside the safe claim window');
  if (
    input.preimageHash.length !== 32 ||
    input.claimPublicKey.length !== 33 ||
    !ecc.isPoint(input.claimPublicKey)
  )
    throw new Error('Invalid local reverse swap keys');
  if (
    typeof swap.refundPublicKey !== 'string' ||
    !/^(?:(?:02|03))?[0-9a-f]{64}$/i.test(swap.refundPublicKey)
  )
    throw new Error('Invalid reverse swap refund key');
  const refundKey = Buffer.from(
    swap.refundPublicKey.length === 64 ? `02${swap.refundPublicKey}` : swap.refundPublicKey,
    'hex',
  );
  if (!ecc.isPoint(refundKey)) throw new Error('Invalid reverse swap refund key');
  const claim = bitcoin.script.compile([
    bitcoin.opcodes.OP_SIZE,
    bitcoin.script.number.encode(32),
    bitcoin.opcodes.OP_EQUALVERIFY,
    bitcoin.opcodes.OP_HASH160,
    bitcoin.crypto.ripemd160(input.preimageHash),
    bitcoin.opcodes.OP_EQUALVERIFY,
    input.claimPublicKey.subarray(1),
    bitcoin.opcodes.OP_CHECKSIG,
  ]);
  const refund = bitcoin.script.compile([
    refundKey.subarray(1),
    bitcoin.opcodes.OP_CHECKSIGVERIFY,
    bitcoin.script.number.encode(swap.timeoutBlockHeight),
    bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
  ]);
  for (const [leaf, expected] of [
    [swap.swapTree?.claimLeaf, claim],
    [swap.swapTree?.refundLeaf, refund],
  ] as const) {
    if (
      leaf?.version !== 0xc0 ||
      typeof leaf.output !== 'string' ||
      leaf.output.toLowerCase() !== Buffer.from(expected).toString('hex')
    )
      throw new Error('Reverse swap script does not match our claim and refund conditions');
  }
  const output = bitcoin.payments.p2tr({
    internalPubkey: keyAggExport(keyAggregate([refundKey, input.claimPublicKey])),
    scriptTree: [
      { output: claim, version: 0xc0 },
      { output: refund, version: 0xc0 },
    ],
  }).output;
  let received: Uint8Array;
  try {
    received = bitcoin.address.toOutputScript(swap.lockupAddress, bitcoin.networks.bitcoin);
  } catch {
    throw new Error('Invalid reverse swap lockup address');
  }
  if (!output || !Buffer.from(output).equals(Buffer.from(received)))
    throw new Error('Reverse swap address does not match the verified scripts');
}

/** Read old recovery records' timeout from the canonical refund script.
 * verifyReverseSwap still checks the entire script before using this value.
 */
export function reverseRefundHeight(swapTree: VerifiedReverseSwap['swapTree']): number {
  const chunks = bitcoin.script.decompile(Buffer.from(swapTree.refundLeaf.output, 'hex'));
  if (!chunks || !(chunks[2] instanceof Uint8Array)) throw new Error('Invalid refund timeout');
  return bitcoin.script.number.decode(chunks[2]);
}

export function verifyReverseLockup(
  txHex: string,
  swap: Pick<VerifiedReverseSwap, 'lockupAddress' | 'onchainAmount'>,
) {
  const tx = bitcoin.Transaction.fromHex(txHex);
  const output = extractLockupFromTxHex(txHex, swap.lockupAddress);
  if (!output || output.amount !== swap.onchainAmount)
    throw new Error('Reverse lockup does not pay the verified address and amount');
  return { txId: tx.getId(), ...output, txHex };
}
