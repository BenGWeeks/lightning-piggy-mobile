import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { LnurlWithdrawHost, openLnurlWithdrawSheet } from './LnurlWithdrawSheet';

let mockDismiss: (() => void) | null = null;
jest.mock('@gorhom/bottom-sheet', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  return {
    BottomSheetModal: R.forwardRef(function Modal(
      { children, onDismiss }: { children: React.ReactNode; onDismiss: () => void },
      ref: React.Ref<unknown>,
    ) {
      mockDismiss = onDismiss;
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
jest.mock('../contexts/LocaleContext', () =>
  (() => {
    const context = { useTranslation: () => (key: string) => key };
    return {
      ...context,
      useLocale: () => ({ t: context.useTranslation(), locale: 'en', formatLocale: 'en' }),
    };
  })(),
);
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
jest.mock('./PrizeWalletPicker', () => {
  const React = jest.requireActual('react');
  const { Button } = jest.requireActual('react-native');
  return function PrizeWalletPicker({ onAddWallet }: { onAddWallet: () => void }) {
    return React.createElement(Button, {
      title: 'Add wallet',
      testID: 'test-add-wallet',
      onPress: onAddWallet,
    });
  };
});
const mockWizardProps = jest.fn();
const mockWizardUnmount = jest.fn();
jest.mock('./LazyAddWalletWizard', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    usePrefetchAddWalletWizard: jest.fn(),
    default: function Wizard(props: { visible: boolean; onClose: () => void }) {
      const [token] = React.useState({});
      mockWizardProps(props, token);
      React.useEffect(() => () => mockWizardUnmount(), []);
      return null;
    },
  };
});

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

it('resolves the same voucher again after dismissing and reopening, with confirmation reset', async () => {
  render(<LnurlWithdrawHost />);
  const voucher = 'lnurlw://example.com/voucher';
  await act(async () => {
    openLnurlWithdrawSheet(voucher, 'first', true);
  });
  expect(screen.getByTestId('lnurl-withdraw-claim-button')).toBeTruthy();
  act(() => mockDismiss!());
  expect(screen.queryByTestId('lnurl-withdraw-claim-button')).toBeNull();
  await act(async () => {
    openLnurlWithdrawSheet(voucher, 'active', true);
  });
  expect(mockResolve).toHaveBeenCalledTimes(2);
  expect(mockClaim).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByTestId('lnurl-withdraw-claim-button')));
  expect(mockMakeInvoice).toHaveBeenCalledWith('active', 21, 'Voucher');
});

it('does not mount a wizard on startup or when dismissing an unused claim sheet', async () => {
  render(<LnurlWithdrawHost />);
  expect(mockWizardProps).not.toHaveBeenCalled();
  await act(async () => openLnurlWithdrawSheet('lnurlw://example.com/voucher', 'first', true));
  act(() => mockDismiss!());
  expect(mockWizardProps).not.toHaveBeenCalled();
});

it('retains the first-use wizard instance across close, dismiss and reopen', async () => {
  render(<LnurlWithdrawHost />);
  await act(async () => openLnurlWithdrawSheet('lnurlw://example.com/voucher', 'first', true));
  act(() => fireEvent.press(screen.getByTestId('test-add-wallet')));
  const [props, token] = mockWizardProps.mock.calls.at(-1)!;
  expect(props.visible).toBe(true);
  act(() => props.onClose());
  expect(mockWizardProps.mock.calls.at(-1)![0].visible).toBe(false);
  act(() => mockDismiss!());
  await act(async () => openLnurlWithdrawSheet('lnurlw://example.com/voucher', 'first', true));
  act(() => fireEvent.press(screen.getByTestId('test-add-wallet')));
  expect(mockWizardProps.mock.calls.at(-1)).toEqual([
    expect.objectContaining({ visible: true }),
    token,
  ]);
  expect(mockWizardUnmount).not.toHaveBeenCalled();
});
