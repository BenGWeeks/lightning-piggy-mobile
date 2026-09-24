import { bech32 } from 'bech32';
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { p2tr, Script } from '@scure/btc-signer';
import { keyAggregate, keyAggExport } from '@scure/btc-signer/musig2.js';
import * as bitcoin from 'bitcoinjs-lib';
import { createReverseSwap, claimSwap, getReverseSwapFees } from './boltzService';
import { getBlockHeight, broadcastRawTx, getSwapClaimFeeRate } from './onchainService';
import { verifyReverseSwap, verifyReverseLockup } from '../utils/reverseSwapVerify';
import AsyncStorage from '@react-native-async-storage/async-storage';
jest.mock('./onchainService', () => ({
  getBlockHeight: jest.fn(),
  getSwapClaimFeeRate: jest.fn(async () => 2),
  broadcastRawTx: jest.fn(),
}));
const HEIGHT = 900000;
const PRIVATE = new Uint8Array(32).fill(2);
const CLAIM = secp256k1.getPublicKey(PRIVATE, true);
const REFUND = secp256k1.getPublicKey(new Uint8Array(32).fill(3), true);
const HASH = new Uint8Array(32).fill(7);
const toHex = (v: Uint8Array) => Buffer.from(v).toString('hex');
function invoice(hash: Uint8Array) {
  return bech32.encode(
    'lnbc1m',
    [...Array(7).fill(0), 1, 1, 20, ...bech32.toWords(hash), ...Array(104).fill(0)],
    2000,
  );
}
function fixture(
  claim: Uint8Array = CLAIM,
  hash: Uint8Array = HASH,
  timeout = HEIGHT + 144,
  xOnly = false,
) {
  const refund = xOnly ? Uint8Array.from([2, ...REFUND.slice(1)]) : REFUND;
  const a = Script.encode([
    'SIZE',
    32,
    'EQUALVERIFY',
    'HASH160',
    ripemd160(hash),
    'EQUALVERIFY',
    claim.slice(1),
    'CHECKSIG',
  ]);
  const b = Script.encode([refund.slice(1), 'CHECKSIGVERIFY', timeout, 'CHECKLOCKTIMEVERIFY']);
  return {
    id: 'reverse-test',
    invoice: invoice(hash),
    onchainAmount: 98500,
    timeoutBlockHeight: timeout,
    refundPublicKey: toHex(xOnly ? refund.slice(1) : refund),
    lockupAddress: p2tr(
      keyAggExport(keyAggregate([refund, claim])),
      [
        { script: a, leafVersion: 0xc0 },
        { script: b, leafVersion: 0xc0 },
      ],
      undefined,
      true,
    ).address!,
    swapTree: {
      claimLeaf: { version: 0xc0, output: toHex(a) },
      refundLeaf: { version: 0xc0, output: toHex(b) },
    },
  };
}
const input = {
  preimageHash: HASH,
  claimPublicKey: CLAIM,
  expectedAmount: 98500,
  currentBlockHeight: HEIGHT,
};
it('accepts an independently constructed canonical reverse tree including x-only refund keys', () => {
  verifyReverseSwap(fixture(), input);
  verifyReverseSwap(fixture(CLAIM, HASH, HEIGHT + 144, true), input);
});
it.each([HEIGHT - 1, HEIGHT, HEIGHT + 5, HEIGHT + 1015, 500000000])(
  'rejects unsafe refund deadline %s even with a consistent tree',
  (height) => {
    expect(() => verifyReverseSwap(fixture(CLAIM, HASH, height), input)).toThrow(/timeout/);
  },
);
it('rejects a claim leaf that requires a different preimage or key', () => {
  expect(() => verifyReverseSwap(fixture(CLAIM, new Uint8Array(32).fill(9)), input)).toThrow(
    /script/,
  );
  expect(() => verifyReverseSwap(fixture(REFUND), input)).toThrow(/script/);
});
it.each(['amount', 'address', 'version', 'extra-op'])('rejects %s tampering', (field) => {
  const swap = fixture();
  if (field === 'amount') swap.onchainAmount--;
  if (field === 'address') swap.lockupAddress = fixture(REFUND).lockupAddress;
  if (field === 'version') swap.swapTree.claimLeaf.version = 0xc2;
  if (field === 'extra-op') swap.swapTree.refundLeaf.output += '51';
  expect(() => verifyReverseSwap(swap, input)).toThrow();
});
function lockup(address: string, amount: number) {
  const tx = new bitcoin.Transaction();
  tx.addInput(new Uint8Array(32).fill(4), 0);
  tx.addOutput(bitcoin.address.toOutputScript(address), BigInt(amount));
  return tx;
}
it('derives the real transaction id and output, rejecting an underfunded lockup', () => {
  const swap = fixture();
  const tx = lockup(swap.lockupAddress, swap.onchainAmount);
  expect(verifyReverseLockup(tx.toHex(), swap)).toMatchObject({
    txId: tx.getId(),
    vout: 0,
    amount: 98500,
  });
  expect(() => verifyReverseLockup(lockup(swap.lockupAddress, 98000).toHex(), swap)).toThrow(
    /amount/,
  );
  expect(() =>
    verifyReverseLockup(lockup(fixture(REFUND).lockupAddress, 98500).toHex(), swap),
  ).toThrow(/address/);
});

describe('creation before funding', () => {
  const originalFetch = global.fetch;
  let mutate: (s: ReturnType<typeof fixture>) => unknown;
  let fetchMock: jest.Mock;
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    jest.mocked(getBlockHeight).mockResolvedValue(HEIGHT);
    mutate = (s) => s;
    fetchMock = jest.fn(async (_url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body);
        return {
          ok: true,
          json: async () =>
            mutate(
              fixture(
                Buffer.from(body.claimPublicKey, 'hex'),
                Buffer.from(body.preimageHash, 'hex'),
              ),
            ),
        };
      }
      return {
        ok: true,
        json: async () => ({
          BTC: {
            BTC: {
              hash: 'reverse-quote',
              limits: { minimal: 10000, maximal: 200000 },
              fees: { percentage: 0.5, minerFees: { lockup: 1000, claim: 300 } },
            },
          },
        }),
      };
    });
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('pins the un-referred quote and returns a verified reverse swap', async () => {
    const swap = await createReverseSwap(fixture().lockupAddress, 100000);
    expect(swap.onchainAmount).toBe(98500);
    const body = JSON.parse(
      fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')[1].body,
    );
    expect(body.pairHash).toBe('reverse-quote');
    expect(body).not.toHaveProperty('referralId');
  });
  it.each(['amount', 'address', 'script', 'timeout'])(
    'rejects %s before a caller can pay',
    async (field) => {
      mutate = (s) => {
        if (field === 'amount') s.onchainAmount--;
        if (field === 'address') s.lockupAddress = fixture(REFUND).lockupAddress;
        if (field === 'script') s.swapTree.claimLeaf.output += '51';
        if (field === 'timeout') s.timeoutBlockHeight = HEIGHT;
        return s;
      };
      const pay = jest.fn();
      await expect(createReverseSwap(fixture().lockupAddress, 100000).then(pay)).rejects.toThrow();
      expect(pay).not.toHaveBeenCalled();
    },
  );
  it('rejects a changed quote before creating or paying a swap', async () => {
    const quote = await getReverseSwapFees();
    await expect(
      createReverseSwap(fixture().lockupAddress, 100000, { ...quote, pairHash: 'old' }),
    ).rejects.toThrow(/changed/);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it('builds a verifiable script-path claim using the current Electrum fee estimate', async () => {
    const preimage = new Uint8Array(32).fill(5);
    const swap = {
      ...fixture(CLAIM, bitcoin.crypto.sha256(preimage), HEIGHT + 144, true),
      preimage: toHex(preimage),
      claimPrivateKey: toHex(PRIVATE),
    };
    const tx = lockup(swap.lockupAddress, swap.onchainAmount);
    jest.mocked(getSwapClaimFeeRate).mockResolvedValueOnce(4);
    await claimSwap(swap, verifyReverseLockup(tx.toHex(), swap), fixture(REFUND).lockupAddress);
    const raw = jest.mocked(broadcastRawTx).mock.calls[0][0];
    const claim = bitcoin.Transaction.fromHex(raw);
    expect(Number(claim.outs[0].value)).toBe(98500 - 180 * 4);
    expect(toHex(claim.ins[0].witness[1])).toBe(toHex(preimage));
    const script = claim.ins[0].witness[2];
    const leaf = bitcoin.crypto.taggedHash(
      'TapLeaf',
      Uint8Array.from([0xc0, script.length, ...script]),
    );
    const digest = claim.hashForWitnessV1(
      0,
      [bitcoin.address.toOutputScript(swap.lockupAddress)],
      [98500n],
      0,
      leaf,
    );
    expect(schnorr.verify(claim.ins[0].witness[0], digest, CLAIM.slice(1))).toBe(true);
  });
  it('refuses to disclose a preimage after the safe claim window has passed', async () => {
    const preimage = new Uint8Array(32).fill(5);
    const swap = {
      ...fixture(CLAIM, bitcoin.crypto.sha256(preimage)),
      preimage: toHex(preimage),
      claimPrivateKey: toHex(PRIVATE),
    };
    const tx = lockup(swap.lockupAddress, swap.onchainAmount);
    jest.mocked(getBlockHeight).mockResolvedValue(HEIGHT + 140);
    await expect(
      claimSwap(swap, verifyReverseLockup(tx.toHex(), swap), fixture(REFUND).lockupAddress),
    ).rejects.toThrow(/timeout/);
    expect(broadcastRawTx).not.toHaveBeenCalled();
  });
});
