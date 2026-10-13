import {
  getTransferDestinationWallets,
  selectTransferDestination,
} from './transferDestinationWallets';
import type { WalletMetadata, WalletState } from '../types/wallet';

const wallet = (id: string, props: Partial<WalletState> = {}): WalletState => ({
  id,
  alias: id,
  theme: 'lightning-piggy',
  order: 0,
  walletType: 'nwc',
  lightningAddress: 'piggy@example.com',
  isConnected: true,
  balance: 0,
  walletAlias: null,
  transactions: [],
  ...props,
});
const watch = wallet('watch', { walletType: 'onchain', onchainImportMethod: 'xpub' });
const other: WalletMetadata = {
  id: 'other-profile-lightning',
  alias: 'Other',
  theme: 'lightning-piggy',
  order: 0,
  walletType: 'nwc',
  lightningAddress: 'other@example.com',
};

test('switching to watch-only replaces an on-chain destination in the selected profile', () => {
  const onchain = wallet('other-onchain', { walletType: 'onchain' });
  const selectedProfile = [onchain, other];
  const destination = selectTransferDestination(watch, onchain.id, selectedProfile, true);
  expect(destination).toBe(other.id);
  expect(selectedProfile.find((candidate) => candidate.id === destination)).toBe(other);
  expect(getTransferDestinationWallets(watch, selectedProfile, true)).toEqual([other]);
});

test('switching to watch-only preserves a valid selected cross-profile Lightning wallet', () => {
  const selected = { ...other, id: 'selected' };
  expect(selectTransferDestination(watch, selected.id, [other, selected], true)).toBe(selected.id);
});

test('switching to watch-only preserves a valid active-profile Lightning wallet', () => {
  expect(
    selectTransferDestination(watch, 'selected', [wallet('first'), wallet('selected')], false),
  ).toBe('selected');
});

test('active-profile replacements exclude the source, on-chain and disconnected wallets', () => {
  const wallets = [
    watch,
    wallet('offline', { isConnected: false }),
    wallet('hot', { walletType: 'onchain', onchainImportMethod: 'mnemonic' }),
    wallet('connected'),
  ];
  expect(selectTransferDestination(watch, 'offline', wallets, false)).toBe('connected');
});

test('no eligible destination in the selected profile clears the selection', () => {
  expect(
    selectTransferDestination(
      watch,
      'active-profile-lightning',
      [wallet('other-onchain', { walletType: 'onchain' })],
      true,
    ),
  ).toBeNull();
});

test('a signing source still permits on-chain destinations and replaces itself', () => {
  const source = wallet('source');
  const onchain = wallet('onchain', { walletType: 'onchain' });
  expect(selectTransferDestination(source, source.id, [source, onchain], false)).toBe(onchain.id);
  expect(selectTransferDestination(source, onchain.id, [wallet('first'), onchain], false)).toBe(
    onchain.id,
  );
});
