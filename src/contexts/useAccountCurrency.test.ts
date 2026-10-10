import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAccountCurrency } from './useAccountCurrency';
import { loadAccountPref, saveAccountPref } from '../services/accountDisplayPrefs';
import { getBtcPrice } from '../services/fiatService';

let mockOwner = 'big';
jest.mock('../hooks/useActivePubkey', () => ({ useActivePubkey: () => mockOwner }));
jest.mock('../services/accountDisplayPrefs', () => ({
  CURRENCY_PREF_KEY_BASE: 'user_fiat_currency',
  peekAccountPref: (_base: string, owner: string) => (owner === 'big' ? 'EUR' : 'GBP'),
  loadAccountPref: jest.fn(),
  saveAccountPref: jest.fn(async () => {}),
}));
jest.mock('../services/fiatService', () => ({
  CURRENCIES: ['USD', 'GBP', 'EUR'],
  getBtcPrice: jest.fn(),
}));

beforeEach(() => {
  mockOwner = 'big';
  jest.clearAllMocks();
  (loadAccountPref as jest.Mock).mockImplementation(async (_base, owner) =>
    owner === 'big' ? 'EUR' : 'GBP',
  );
  (getBtcPrice as jest.Mock).mockResolvedValue(50000);
});

it('switches immediately and saves using the new owner, rejecting the old setter', async () => {
  const { result, rerender } = renderHook(() => useAccountCurrency());
  await waitFor(() => expect(result.current.btcPrice).toBe(50000));
  const oldSetter = result.current.setCurrency;
  mockOwner = 'middle';
  rerender({});
  expect(result.current.currency).toBe('GBP');
  await act(async () => {
    await oldSetter('USD');
  });
  expect(result.current.currency).toBe('GBP');
  await act(async () => {
    await result.current.setCurrency('EUR');
  });
  expect(result.current.currency).toBe('EUR');
  expect(saveAccountPref).toHaveBeenLastCalledWith('user_fiat_currency', 'EUR', 'middle');
});

it('never exposes an old currency exchange rate after switching', async () => {
  let finishOld!: (value: number) => void;
  (getBtcPrice as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  const { result, rerender } = renderHook(() => useAccountCurrency());
  mockOwner = 'middle';
  rerender({});
  await waitFor(() => expect(result.current.btcPrice).toBe(50000));
  await act(async () => {
    finishOld(12345);
  });
  expect(result.current.btcPrice).toBe(50000);
});
