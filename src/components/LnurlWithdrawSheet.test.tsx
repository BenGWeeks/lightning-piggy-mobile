import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { LnurlWithdrawHost, openLnurlWithdrawSheet } from './LnurlWithdrawSheet';

jest.mock('@gorhom/bottom-sheet', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  return {
    BottomSheetModal: R.forwardRef(function Modal(
      { children }: { children: React.ReactNode },
      ref: React.Ref<unknown>,
    ) {
      R.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
      return R.createElement(RN.View, null, children);
    }),
    BottomSheetScrollView: RN.View,
    BottomSheetTextInput: RN.TextInput,
    BottomSheetBackdrop: () => null,
  };
});
jest.mock('lucide-react-native', () => ({ Gift: () => null, PartyPopper: () => null }));
jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../styles/LnurlWithdrawSheet.styles', () => ({
  createLnurlWithdrawSheetStyles: () => ({}),
}));
const mockWallets = [
  { id: 'first', walletType: 'nwc' },
  { id: 'active', walletType: 'nwc' },
];
const mockMakeInvoice = jest.fn(async () => 'lnbcfixture');
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({
    wallets: mockWallets,
    activeWalletId: 'active',
    makeInvoiceForWallet: mockMakeInvoice,
    expectPayment: jest.fn(),
    currency: 'GBP',
  }),
  useWalletLive: () => ({ btcPrice: null, lastIncomingPayment: null }),
}));
const mockResolve = jest.fn();
const mockClaim = jest.fn(async (_params, makeInvoice) => ({
  sats: 21,
  bolt11: await makeInvoice(21, 'Voucher'),
}));
jest.mock('../services/lnurlWithdrawService', () => ({
  ...jest.requireActual('../services/lnurlWithdrawService'),
  resolveLnurlWithdraw: (...args: unknown[]) => mockResolve(...args),
  claimLnurlWithdraw: (...args: Parameters<typeof mockClaim>) => mockClaim(...args),
}));
jest.mock('../services/claimHistoryService', () => ({ recordClaim: jest.fn() }));
jest.mock('../utils/bolt11', () => ({ paymentHashFromBolt11: () => 'fixture-hash' }));
jest.mock('../utils/fiat', () => ({ formatFiatApprox: () => '' }));
jest.mock('./AmountSlider', () => ({ AmountSlider: () => null }));
jest.mock('./PrizeWalletPicker', () => () => null);
jest.mock('./AddWalletWizard', () => () => null);

beforeEach(() => {
  jest.clearAllMocks();
  mockResolve.mockResolvedValue({
    callback: 'https://example.com/callback',
    k1: 'fixture',
    defaultDescription: 'Voucher',
    minWithdrawable: 21000,
    maxWithdrawable: 21000,
  });
});

it('requires redemption after scanning a fixed voucher and invoices the chosen wallet', async () => {
  render(<LnurlWithdrawHost />);
  await act(async () => {
    openLnurlWithdrawSheet('lnurlw://example.com/voucher', 'first', true);
  });
  expect(mockClaim).not.toHaveBeenCalled();
  expect(mockMakeInvoice).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(screen.getByTestId('lnurl-withdraw-claim-button'));
  });
  expect(mockMakeInvoice).toHaveBeenCalledWith('first', 21, 'Voucher');
});

it('defaults deep-link claims to the active Lightning wallet', async () => {
  render(<LnurlWithdrawHost />);
  await act(async () => {
    openLnurlWithdrawSheet('lnurlw://example.com/voucher');
  });
  expect(mockMakeInvoice).toHaveBeenCalledWith('active', 21, 'Voucher');
});

it('does not mint an invoice when a scanned voucher cannot resolve', async () => {
  mockResolve.mockRejectedValue(new Error('Expired voucher'));
  render(<LnurlWithdrawHost />);
  await act(async () => {
    openLnurlWithdrawSheet('lnurlw://example.com/expired', 'first', true);
  });
  expect(mockMakeInvoice).not.toHaveBeenCalled();
  expect(mockClaim).not.toHaveBeenCalled();
  expect(screen.queryByTestId('lnurl-withdraw-claim-button')).toBeNull();
});
