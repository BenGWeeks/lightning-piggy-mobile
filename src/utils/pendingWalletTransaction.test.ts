import type { WalletState, WalletTransaction } from '../types/wallet';
import { upsertPendingWalletTransaction } from './pendingWalletTransaction';

const counterparty = { pubkey: 'recipient', profile: null, comment: 'thanks', anonymous: false };
const pending: WalletTransaction = {
  type: 'outgoing',
  amount: 21,
  paymentHash: 'abc',
  created_at: 200,
  settled_at: 200,
  optimistic: true,
  zapCounterparty: counterparty,
};
const wallet = (id: string, transactions: WalletTransaction[]): WalletState =>
  ({ id, transactions }) as WalletState;

it('upserts attribution when refresh inserts the real transaction before persistence finishes', async () => {
  let finishPersistence!: () => void;
  const persistence = new Promise<void>((resolve) => {
    finishPersistence = resolve;
  });
  let wallets = [wallet('a', [])];
  const attribution = (async () => {
    await persistence;
    wallets = upsertPendingWalletTransaction(wallets, 'a', pending);
  })();
  const real: WalletTransaction = {
    type: 'outgoing',
    amount: 21,
    paymentHash: 'ABC',
    created_at: 100,
    settled_at: 101,
    settled: true,
    feesSats: 2,
    preimage: 'proof',
  };
  const otherWallet = wallet('b', [pending]);
  wallets = [wallet('a', [real]), otherWallet];
  finishPersistence();
  await attribution;
  expect(wallets[0].transactions).toEqual([{ ...real, zapCounterparty: counterparty }]);
  expect(wallets[0].transactions[0].optimistic).toBeUndefined();
  expect(wallets[1]).toBe(otherWallet);
});

it('inserts a missing outgoing leg without replacing the incoming leg of a self-payment', () => {
  const incoming: WalletTransaction = { type: 'incoming', amount: 21, paymentHash: 'abc' };
  const first = upsertPendingWalletTransaction([wallet('a', [incoming])], 'a', pending);
  expect(first[0].transactions).toEqual([pending, incoming]);
  const repeated = upsertPendingWalletTransaction(first, 'a', pending);
  expect(repeated[0].transactions).toEqual([pending, incoming]);
});

it('does not match unrelated hashless transactions or change a missing wallet', () => {
  const hashless = { ...pending, paymentHash: undefined };
  const wallets = [wallet('a', [hashless])];
  expect(upsertPendingWalletTransaction(wallets, 'a', hashless)[0].transactions).toHaveLength(2);
  expect(upsertPendingWalletTransaction(wallets, 'missing', pending)[0]).toBe(wallets[0]);
});
