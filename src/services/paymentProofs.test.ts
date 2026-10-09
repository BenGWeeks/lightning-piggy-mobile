import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import {
  clearPaymentProofsForTests,
  getPaymentProof,
  hydratePaymentProofs,
  recordPaymentProof,
} from './paymentProofs';

const W = 'wallet-1';
const key = (h: string, w = W) => `${w}:${h}`;
const pre = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const hashOf = (p: string) => bytesToHex(sha256(hexToBytes(p)));

describe('paymentProofs', () => {
  beforeEach(async () => {
    clearPaymentProofsForTests();
    await AsyncStorage.clear();
  });

  it('keys a proof by the hash computed from the preimage', () => {
    recordPaymentProof(W, pre(1).toUpperCase());
    expect(getPaymentProof(W, hashOf(pre(1)))).toBe(pre(1));
    expect(getPaymentProof(W, hashOf(pre(1)).toUpperCase())).toBe(pre(1));
    expect(getPaymentProof(W, hashOf(pre(2)))).toBeUndefined();
  });

  it('ignores malformed preimages', () => {
    for (const bad of ['', 'zz', 'ab', undefined, null]) recordPaymentProof(W, bad);
    expect(getPaymentProof(W, hashOf(pre(1)))).toBeUndefined();
  });

  it('keeps only the newest 200 proofs', () => {
    for (let i = 0; i < 201; i++)
      recordPaymentProof(W, pre(i % 256).slice(0, 62) + i.toString(16).padStart(2, '0'));
    const first = pre(0).slice(0, 62) + '00';
    const last = pre(200).slice(0, 62) + (200).toString(16).padStart(2, '0');
    expect(getPaymentProof(W, hashOf(first))).toBeUndefined();
    expect(getPaymentProof(W, hashOf(last))).toBe(last);
  });

  it("keeps earlier sessions' proofs when paying before the first hydration", async () => {
    recordPaymentProof(W, pre(7));
    await hydratePaymentProofs();
    await new Promise((r) => setTimeout(r, 0));
    clearPaymentProofsForTests(); // restart
    recordPaymentProof(W, pre(8)); // pay before any tx-list fetch hydrated
    await new Promise((r) => setTimeout(r, 0));
    clearPaymentProofsForTests(); // restart again
    await hydratePaymentProofs();
    expect(getPaymentProof(W, hashOf(pre(7)))).toBe(pre(7));
    expect(getPaymentProof(W, hashOf(pre(8)))).toBe(pre(8));
  });

  it("ignores a corrupt store without losing this session's proofs", async () => {
    for (const junk of ['{not json', '42', JSON.stringify([['x', 'y'], 5])]) {
      clearPaymentProofsForTests();
      await AsyncStorage.setItem('payment_proofs_v2', junk);
      recordPaymentProof(W, pre(9));
      await hydratePaymentProofs();
      expect(getPaymentProof(W, hashOf(pre(9)))).toBe(pre(9));
    }
  });

  it('rejects a stored pair whose preimage does not hash to its key', async () => {
    await AsyncStorage.setItem(
      'payment_proofs_v2',
      JSON.stringify([
        [key(hashOf(pre(1))), pre(2)], // mismatched: valid hex, wrong preimage
        [key(hashOf(pre(3))), pre(3)],
        [hashOf(pre(4)), pre(4)], // unscoped v1-style entry
      ]),
    );
    await hydratePaymentProofs();
    expect(getPaymentProof(W, hashOf(pre(1)))).toBeUndefined();
    expect(getPaymentProof(W, hashOf(pre(3)))).toBe(pre(3));
    expect(getPaymentProof(W, hashOf(pre(4)))).toBeUndefined();
  });

  it('scopes a proof to the wallet that paid', () => {
    recordPaymentProof(W, pre(1));
    expect(getPaymentProof(W, hashOf(pre(1)))).toBe(pre(1));
    expect(getPaymentProof('wallet-2', hashOf(pre(1)))).toBeUndefined();
    expect(getPaymentProof(undefined, hashOf(pre(1)))).toBeUndefined();
  });

  it('never overwrites the store after a failed read, and retries hydration', async () => {
    recordPaymentProof(W, pre(7));
    await hydratePaymentProofs();
    await new Promise((r) => setTimeout(r, 0));
    clearPaymentProofsForTests(); // restart
    // The AsyncStorage jest mock's methods are already jest.fn()s.
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('transient read failure'));
    const setItem = jest.mocked(AsyncStorage.setItem);
    setItem.mockClear();
    recordPaymentProof(W, pre(8)); // pay while the store is unreadable
    await new Promise((r) => setTimeout(r, 0));
    expect(setItem).not.toHaveBeenCalled();
    expect(await hydratePaymentProofs()).toBe(true); // retried, read succeeds
    await new Promise((r) => setTimeout(r, 0));
    clearPaymentProofsForTests(); // restart again
    await hydratePaymentProofs();
    expect(getPaymentProof(W, hashOf(pre(7)))).toBe(pre(7));
    expect(getPaymentProof(W, hashOf(pre(8)))).toBe(pre(8));
  });

  it('survives an app restart (persisted, then hydrated)', async () => {
    recordPaymentProof(W, pre(7));
    await new Promise((r) => setTimeout(r, 0)); // let the AsyncStorage write land
    clearPaymentProofsForTests(); // "restart": memory gone, storage kept
    expect(getPaymentProof(W, hashOf(pre(7)))).toBeUndefined();
    await hydratePaymentProofs();
    expect(getPaymentProof(W, hashOf(pre(7)))).toBe(pre(7));
  });
});
