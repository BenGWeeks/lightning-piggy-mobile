// waitForSubmarineSwapComplete's status callback (#1179): the Move sheet
// narrates the 1-confirmation wait from it, so every status must reach it —
// and a throwing callback must never fail the swap watch.
jest.mock('expo-secure-store', () => ({}));
jest.mock('@bitcoinerlab/secp256k1', () => ({}));
jest.mock('bip32', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('@scure/btc-signer/musig2.js', () => ({}));
jest.mock('bitcoinjs-lib', () => ({}));
jest.mock('../utils/bolt11', () => ({}));
jest.mock('../utils/reverseSwapVerify', () => ({}));
jest.mock('../utils/submarineSwapVerify', () => ({}));
jest.mock('../utils/boltzVerify', () => ({}));
jest.mock('../utils/lockupTx', () => ({}));
jest.mock('./onchainService', () => ({}));
jest.mock('./boltzSwapStatus', () => ({ waitForSwapStatus: jest.fn() }));

import { waitForSwapStatus } from './boltzSwapStatus';
import { waitForSubmarineSwapComplete } from './boltzService';

const STATUSES = ['invoice.set', 'transaction.mempool', 'transaction.confirmed', 'invoice.paid'];

beforeEach(() => {
  (waitForSwapStatus as jest.Mock).mockImplementation(
    async (_id: string, isTerminal: (s: string) => boolean) => {
      for (const s of STATUSES) if (isTerminal(s)) return { status: s };
      throw new Error('never terminal');
    },
  );
});

it('reports every status on the way to completion', async () => {
  const onStatus = jest.fn();
  await waitForSubmarineSwapComplete('sw1', 3_600_000, onStatus);
  expect(onStatus.mock.calls.map(([s]) => s)).toEqual(STATUSES);
  expect(waitForSwapStatus).toHaveBeenCalledWith('sw1', expect.any(Function), 3_600_000);
});

it('a throwing status callback does not fail the watch', async () => {
  const onStatus = jest.fn(() => {
    throw new Error('setState on an unmounted sheet');
  });
  await expect(waitForSubmarineSwapComplete('sw1', 1000, onStatus)).resolves.toBeUndefined();
});

it('an explicit Boltz failure still rejects', async () => {
  (waitForSwapStatus as jest.Mock).mockImplementation(
    async (_id: string, isTerminal: (s: string) => boolean) => isTerminal('swap.expired'),
  );
  await expect(waitForSubmarineSwapComplete('sw1', 1000, jest.fn())).rejects.toThrow(
    'Swap failed with status: swap.expired',
  );
});
