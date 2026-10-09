import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import {
  clearPaymentProofsForTests,
  getPaymentProof,
  hydratePaymentProofs,
  recordPaymentProof,
} from './paymentProofs';

const pre = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const hashOf = (p: string) => bytesToHex(sha256(hexToBytes(p)));

describe('paymentProofs', () => {
  beforeEach(async () => {
    clearPaymentProofsForTests();
    await AsyncStorage.clear();
  });

  it('keys a proof by the hash computed from the preimage', () => {
    recordPaymentProof(pre(1).toUpperCase());
    expect(getPaymentProof(hashOf(pre(1)))).toBe(pre(1));
    expect(getPaymentProof(hashOf(pre(1)).toUpperCase())).toBe(pre(1));
    expect(getPaymentProof(hashOf(pre(2)))).toBeUndefined();
  });

  it('ignores malformed preimages', () => {
    for (const bad of ['', 'zz', 'ab', undefined, null]) recordPaymentProof(bad);
    expect(getPaymentProof(hashOf(pre(1)))).toBeUndefined();
  });

  it('keeps only the newest 200 proofs', () => {
    for (let i = 0; i < 201; i++)
      recordPaymentProof(pre(i % 256).slice(0, 62) + i.toString(16).padStart(2, '0'));
    const first = pre(0).slice(0, 62) + '00';
    const last = pre(200).slice(0, 62) + (200).toString(16).padStart(2, '0');
    expect(getPaymentProof(hashOf(first))).toBeUndefined();
    expect(getPaymentProof(hashOf(last))).toBe(last);
  });

  it("keeps earlier sessions' proofs when paying before the first hydration", async () => {
    recordPaymentProof(pre(7));
    await hydratePaymentProofs();
    await new Promise((r) => setTimeout(r, 0));
    clearPaymentProofsForTests(); // restart
    recordPaymentProof(pre(8)); // pay before any tx-list fetch hydrated
    await new Promise((r) => setTimeout(r, 0));
    clearPaymentProofsForTests(); // restart again
    await hydratePaymentProofs();
    expect(getPaymentProof(hashOf(pre(7)))).toBe(pre(7));
    expect(getPaymentProof(hashOf(pre(8)))).toBe(pre(8));
  });

  it("ignores a corrupt store without losing this session's proofs", async () => {
    for (const junk of ['{not json', '42', JSON.stringify([['x', 'y'], 5])]) {
      clearPaymentProofsForTests();
      await AsyncStorage.setItem('payment_proofs_v1', junk);
      recordPaymentProof(pre(9));
      await hydratePaymentProofs();
      expect(getPaymentProof(hashOf(pre(9)))).toBe(pre(9));
    }
  });

  it('survives an app restart (persisted, then hydrated)', async () => {
    recordPaymentProof(pre(7));
    await new Promise((r) => setTimeout(r, 0)); // let the AsyncStorage write land
    clearPaymentProofsForTests(); // "restart": memory gone, storage kept
    expect(getPaymentProof(hashOf(pre(7)))).toBeUndefined();
    await hydratePaymentProofs();
    expect(getPaymentProof(hashOf(pre(7)))).toBe(pre(7));
  });
});
