import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { keyAggregate, keyAggExport } from '@scure/btc-signer/musig2.js';
import { paymentHashFromBolt11 } from './bolt11';

bitcoin.initEccLib(ecc);

export interface SubmarineSwapResponse {
  id: string;
  address: string;
  expectedAmount: number;
  timeoutBlockHeight: number;
  claimPublicKey: string;
  swapTree: {
    claimLeaf: { version: number; output: string };
    refundLeaf: { version: number; output: string };
  };
}

// A local policy, independent of the swap server: never accept a refund
// lock longer than one week (~144 blocks/day). Standard BTC swaps use ~144.
const MAX_REFUND_BLOCKS = 1008;
const LEAF_VERSION = 0xc0;

/** Validate before exposing a funding address to either Transfer or Receive.
 * Rebuild both canonical scripts and the P2TR output, rather than trusting
 * a self-consistent address/tree supplied by the server. Script template:
 * https://github.com/BoltzExchange/boltz-core/blob/master/lib/swap/SwapTree.ts
 */
export function verifySubmarineSwap(
  raw: unknown,
  input: {
    invoice: string;
    refundPublicKey: Uint8Array;
    expectedAmount: number;
    currentBlockHeight: number;
  },
): asserts raw is SubmarineSwapResponse {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid Boltz swap response');
  const swap = raw as SubmarineSwapResponse;
  if (typeof swap.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(swap.id)) {
    throw new Error('Invalid Boltz swap id');
  }
  if (
    !Number.isSafeInteger(input.expectedAmount) ||
    input.expectedAmount <= 0 ||
    swap.expectedAmount !== input.expectedAmount
  ) {
    throw new Error('Boltz swap amount does not match the quoted amount');
  }
  if (
    !Number.isSafeInteger(input.currentBlockHeight) ||
    input.currentBlockHeight <= 0 ||
    !Number.isSafeInteger(swap.timeoutBlockHeight) ||
    swap.timeoutBlockHeight <= input.currentBlockHeight ||
    swap.timeoutBlockHeight >= 500_000_000 ||
    swap.timeoutBlockHeight - input.currentBlockHeight > MAX_REFUND_BLOCKS
  ) {
    throw new Error('Boltz refund timeout is outside the allowed block window');
  }
  const hash = paymentHashFromBolt11(input.invoice);
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) throw new Error('Invalid swap invoice payment hash');
  if (
    typeof swap.claimPublicKey !== 'string' ||
    !/^(?:(?:02|03))?[0-9a-f]{64}$/i.test(swap.claimPublicKey)
  ) {
    throw new Error('Invalid Boltz claim public key');
  }
  // X-only keys lift to even Y; compressed keys retain their parity for BIP-327.
  const claimKey = Buffer.from(
    swap.claimPublicKey.length === 64 ? `02${swap.claimPublicKey}` : swap.claimPublicKey,
    'hex',
  );
  if (!ecc.isPoint(claimKey)) throw new Error('Invalid Boltz claim public key');
  if (input.refundPublicKey.length !== 33 || !ecc.isPoint(input.refundPublicKey)) {
    throw new Error('Invalid local refund public key');
  }
  const refundKey = Buffer.from(input.refundPublicKey);
  const claimScript = bitcoin.script.compile([
    bitcoin.opcodes.OP_HASH160,
    bitcoin.crypto.ripemd160(Buffer.from(hash, 'hex')),
    bitcoin.opcodes.OP_EQUALVERIFY,
    claimKey.subarray(1),
    bitcoin.opcodes.OP_CHECKSIG,
  ]);
  const refundScript = bitcoin.script.compile([
    refundKey.subarray(1),
    bitcoin.opcodes.OP_CHECKSIGVERIFY,
    bitcoin.script.number.encode(swap.timeoutBlockHeight),
    bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
  ]);
  for (const [leaf, expected] of [
    [swap.swapTree?.claimLeaf, claimScript],
    [swap.swapTree?.refundLeaf, refundScript],
  ] as const) {
    if (
      leaf?.version !== LEAF_VERSION ||
      typeof leaf.output !== 'string' ||
      leaf.output.toLowerCase() !== Buffer.from(expected).toString('hex')
    ) {
      throw new Error('Boltz swap script does not match the invoice and refund conditions');
    }
  }
  // Boltz's compressed key MUST come first in the BIP-327 aggregation.
  const internalPubkey = keyAggExport(keyAggregate([claimKey, refundKey]));
  const output = bitcoin.payments.p2tr({
    internalPubkey,
    scriptTree: [
      { output: claimScript, version: LEAF_VERSION },
      { output: refundScript, version: LEAF_VERSION },
    ],
  }).output;
  let receivedOutput: Uint8Array;
  try {
    receivedOutput = bitcoin.address.toOutputScript(swap.address, bitcoin.networks.bitcoin);
  } catch {
    throw new Error('Invalid Boltz mainnet lockup address');
  }
  if (!output || !Buffer.from(output).equals(Buffer.from(receivedOutput))) {
    throw new Error('Boltz lockup address does not match the verified swap scripts');
  }
}
