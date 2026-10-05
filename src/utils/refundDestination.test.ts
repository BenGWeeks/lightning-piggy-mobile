import { resolveRefundDestination } from './refundDestination';
import {
  getActivePubkey,
  getDefaultOnchainWalletId,
  getWalletList,
} from '../services/walletStorageService';

jest.mock('../services/walletStorageService', () => ({
  getActivePubkey: jest.fn(),
  getWalletList: jest.fn(),
  getDefaultOnchainWalletId: jest.fn(),
}));
const active = getActivePubkey as jest.Mock;
const list = getWalletList as jest.Mock;
const preferred = getDefaultOnchainWalletId as jest.Mock;

const ME = 'a'.repeat(64);
const OTHER = 'c'.repeat(64);
const wallets = [
  { id: 'ln-1', alias: 'Spending', walletType: 'nwc' },
  { id: 'chain-a', alias: 'Savings', walletType: 'onchain' },
  { id: 'chain-b', alias: 'Cold', walletType: 'onchain' },
];

beforeEach(() => {
  active.mockReturnValue(ME);
  list.mockResolvedValue(wallets);
  preferred.mockResolvedValue(null);
});

describe('resolveRefundDestination', () => {
  it('uses the recorded wallet when it is in the active identity', async () => {
    preferred.mockResolvedValue('chain-a');
    expect(await resolveRefundDestination({ sourceWalletId: 'chain-b' })).toEqual({
      kind: 'wallet',
      walletId: 'chain-b',
      alias: 'Cold',
    });
  });

  it('falls back to the default on-chain wallet for a legacy record with no wallet (#1124)', async () => {
    preferred.mockResolvedValue('chain-b');
    expect(await resolveRefundDestination({})).toMatchObject({
      kind: 'wallet',
      walletId: 'chain-b',
    });
  });

  it('falls back to any on-chain wallet, never a Lightning one', async () => {
    preferred.mockResolvedValue('ln-1');
    expect(await resolveRefundDestination({})).toMatchObject({ walletId: 'chain-a' });
  });

  it('reports no-wallet when the active identity has no on-chain wallet', async () => {
    list.mockResolvedValue([wallets[0]]);
    expect(await resolveRefundDestination({})).toEqual({ kind: 'no-wallet' });
  });

  it("never redirects another identity's swap into the active identity's wallet", async () => {
    expect(await resolveRefundDestination({ ownerPubkey: OTHER })).toEqual({
      kind: 'other-identity',
    });
    // Unknown owner + a recorded wallet we can't see: may be another identity's.
    expect(await resolveRefundDestination({ sourceWalletId: 'gone' })).toEqual({
      kind: 'other-identity',
    });
  });

  it("falls back when this identity's own recorded wallet was deleted", async () => {
    expect(
      await resolveRefundDestination({ sourceWalletId: 'gone', ownerPubkey: ME }),
    ).toMatchObject({ kind: 'wallet', walletId: 'chain-a' });
  });
});
