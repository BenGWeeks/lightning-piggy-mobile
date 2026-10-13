import { isExternalFundingSource, isMoveSource } from './moveSources';
import { isSendableWallet } from './walletCapabilities';
import type { WalletState } from '../types/wallet';
const wallet = (props: Partial<WalletState>): WalletState => ({
  id: 'w',
  alias: 'Fixture',
  theme: 'lightning-piggy',
  order: 0,
  walletType: 'nwc',
  lightningAddress: null,
  isConnected: true,
  balance: 0,
  walletAlias: null,
  transactions: [],
  ...props,
});

test.each(['xpub', undefined, 'generated'] as const)(
  'watch-only import %s can Move externally but cannot Send',
  (method) => {
    const source = wallet({ walletType: 'onchain', onchainImportMethod: method });
    expect(isMoveSource(source)).toBe(true);
    expect(isExternalFundingSource(source)).toBe(true);
    expect(isSendableWallet(source)).toBe(false);
  },
);
test('hot wallets keep their signing route', () => {
  const source = wallet({ walletType: 'onchain', onchainImportMethod: 'mnemonic' });
  expect(isMoveSource(source)).toBe(true);
  expect(isExternalFundingSource(source)).toBe(false);
  expect(isSendableWallet(source)).toBe(true);
});
test('only connected Lightning wallets appear as Move sources', () => {
  expect(isMoveSource(wallet({}))).toBe(true);
  expect(isMoveSource(wallet({ isConnected: false }))).toBe(false);
  expect(isExternalFundingSource(wallet({}))).toBe(false);
  expect(isExternalFundingSource(null)).toBe(false);
});
