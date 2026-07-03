// Tests for the cross-profile wallet enumeration helper used by
// TransferSheet (#485). Three invariants matter:
//   1. Reads the per-account namespaced AsyncStorage key
//      (`wallet_list_${pubkey}`), NOT the bare global slot.
//   2. Returns [] for missing / malformed / invalid-pubkey inputs
//      instead of throwing — the Transfer UI must keep rendering
//      even if a profile has no wallets configured yet.
//   3. Does not cross-pollinate: reading profile A's wallets must not
//      surface profile B's wallets, even when both are present in
//      AsyncStorage at the same time.
//
// Mocks AsyncStorage with the official jest mock; no real I/O.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWalletListForPubkey } from './crossProfileWalletService';
import { WalletMetadata } from '../types/wallet';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

const walletA1: WalletMetadata = {
  id: 'wallet-a-1',
  alias: 'A primary',
  theme: 'lightning-piggy',
  order: 0,
  walletType: 'nwc',
  lightningAddress: 'a@example.com',
};

const walletA2: WalletMetadata = {
  id: 'wallet-a-2',
  alias: 'A onchain',
  theme: 'bitcoin',
  order: 1,
  walletType: 'onchain',
  lightningAddress: null,
  onchainImportMethod: 'xpub',
};

const walletB1: WalletMetadata = {
  id: 'wallet-b-1',
  alias: 'B primary',
  theme: 'primal',
  order: 0,
  walletType: 'nwc',
  lightningAddress: null,
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('getWalletListForPubkey', () => {
  it('returns [] when the namespaced key is missing', async () => {
    const out = await getWalletListForPubkey(PK_A);
    expect(out).toEqual([]);
  });

  it('returns [] for null / empty / invalid pubkey', async () => {
    expect(await getWalletListForPubkey(null)).toEqual([]);
    expect(await getWalletListForPubkey(undefined)).toEqual([]);
    expect(await getWalletListForPubkey('')).toEqual([]);
    // Wrong length / non-hex
    expect(await getWalletListForPubkey('not-hex')).toEqual([]);
    expect(await getWalletListForPubkey('a'.repeat(63))).toEqual([]);
    expect(await getWalletListForPubkey('z'.repeat(64))).toEqual([]);
  });

  it('reads the per-account namespaced key, not the bare global slot', async () => {
    // Bare key should be ignored — we read ONLY the namespaced slot.
    await AsyncStorage.setItem('wallet_list', JSON.stringify([walletA1]));
    const out = await getWalletListForPubkey(PK_A);
    expect(out).toEqual([]);
  });

  it('returns the wallet list for the requested pubkey', async () => {
    await AsyncStorage.setItem(`wallet_list_${PK_A}`, JSON.stringify([walletA1, walletA2]));
    const out = await getWalletListForPubkey(PK_A);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('wallet-a-1');
    expect(out[1].id).toBe('wallet-a-2');
  });

  it('isolates profiles — profile A read does not leak profile B wallets', async () => {
    await AsyncStorage.setItem(`wallet_list_${PK_A}`, JSON.stringify([walletA1]));
    await AsyncStorage.setItem(`wallet_list_${PK_B}`, JSON.stringify([walletB1]));
    const aOut = await getWalletListForPubkey(PK_A);
    const bOut = await getWalletListForPubkey(PK_B);
    expect(aOut.map((w) => w.id)).toEqual(['wallet-a-1']);
    expect(bOut.map((w) => w.id)).toEqual(['wallet-b-1']);
  });

  it('returns [] for malformed JSON', async () => {
    await AsyncStorage.setItem(`wallet_list_${PK_A}`, '{not valid json');
    const out = await getWalletListForPubkey(PK_A);
    expect(out).toEqual([]);
  });

  it('returns [] when stored value is non-array JSON', async () => {
    await AsyncStorage.setItem(`wallet_list_${PK_A}`, JSON.stringify({ not: 'an array' }));
    const out = await getWalletListForPubkey(PK_A);
    expect(out).toEqual([]);
  });
});
