import { resolveRefundWalletId } from './refundDestination';
import { getDefaultOnchainWalletId, getWalletList } from '../services/walletStorageService';

jest.mock('../services/walletStorageService', () => ({
  getWalletList: jest.fn(),
  getDefaultOnchainWalletId: jest.fn(),
}));
const list = getWalletList as jest.Mock;
const preferred = getDefaultOnchainWalletId as jest.Mock;

const wallets = [
  { id: 'ln-1', walletType: 'nwc' },
  { id: 'chain-a', walletType: 'onchain' },
  { id: 'chain-b', walletType: 'onchain' },
];

beforeEach(() => {
  list.mockResolvedValue(wallets);
  preferred.mockResolvedValue(null);
});

describe('resolveRefundWalletId', () => {
  it('uses the wallet recorded at swap creation when it still exists', async () => {
    preferred.mockResolvedValue('chain-a');
    expect(await resolveRefundWalletId('chain-b')).toBe('chain-b');
  });

  it('falls back to the default on-chain wallet when none was recorded (#1124)', async () => {
    preferred.mockResolvedValue('chain-b');
    expect(await resolveRefundWalletId(undefined)).toBe('chain-b');
  });

  it('falls back to any on-chain wallet when the recorded/default ones are gone', async () => {
    preferred.mockResolvedValue('deleted');
    expect(await resolveRefundWalletId('also-deleted')).toBe('chain-a');
  });

  it('never picks a Lightning wallet and returns null with no on-chain wallet', async () => {
    list.mockResolvedValue([{ id: 'ln-1', walletType: 'nwc' }]);
    preferred.mockResolvedValue('ln-1');
    expect(await resolveRefundWalletId('ln-1')).toBeNull();
  });
});
