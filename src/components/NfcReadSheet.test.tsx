import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import NfcReadSheet from './NfcReadSheet';
import { readHuntTagPayload } from '../services/nfcService';

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
    BottomSheetView: RN.View,
    BottomSheetTextInput: RN.TextInput,
    BottomSheetBackdrop: () => null,
  };
});
jest.mock('lucide-react-native', () => ({
  Nfc: () => null,
  AlertCircle: () => null,
  PiggyBank: () => null,
  PartyPopper: () => null,
}));
jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () =>
  (() => {
    const context = {
      useTranslation: () => (key: string, params?: { target?: string; amount?: string }) =>
        `${key}${params?.target ? ': ' + params.target : ''}${params?.amount ? ': ' + params.amount : ''}`,
    };
    return {
      ...context,
      useLocale: () => ({ t: context.useTranslation(), locale: 'en', formatLocale: 'en' }),
    };
  })(),
);
jest.mock('../styles/NfcReadSheet.styles', () => ({
  createNfcReadSheetStyles: () => ({}),
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
jest.mock('./NfcScanIndicator', () => () => null);
jest.mock('../services/nfcService', () => ({
  readHuntTagPayload: jest.fn(),
  cancelNfcOperation: jest.fn(),
}));
jest.mock('./PrizeWalletPicker', () => () => null);
jest.mock('./AddWalletWizard', () => () => null);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readHuntTagPayload).mockResolvedValue({
    coord: 'piglet',
    lnurl: 'lnurlw://example.com/voucher',
    lpUrl: null,
    nostrUri: null,
    lightningUri: null,
  });
  mockResolve.mockResolvedValue({
    callback: 'https://example.com/callback',
    k1: 'fixture',
    defaultDescription: 'Voucher',
    minWithdrawable: 21000,
    maxWithdrawable: 21000,
  });
});

it('requires host consent before resolving an NFC tag and shows the amount before Withdraw', async () => {
  const onClose = jest.fn();
  const view = render(<NfcReadSheet visible={false} expectedCoord="piglet" onClose={onClose} />);
  view.rerender(<NfcReadSheet visible expectedCoord="piglet" onClose={onClose} />);
  await act(async () => {});
  expect(mockResolve).not.toHaveBeenCalled();
  expect(screen.getByText('linkAction.withdraw: example.com')).toBeTruthy();
  expect(mockClaim).not.toHaveBeenCalled();
  expect(mockMakeInvoice).not.toHaveBeenCalled();
  expect(screen.queryByTestId('nfc-read-withdraw')).toBeNull();
  await act(async () => fireEvent.press(screen.getByTestId('nfc-read-resolve')));
  expect(mockResolve).toHaveBeenCalledTimes(1);
  expect(screen.getByText('linkAction.withdrawSats: 21')).toBeTruthy();
  expect(mockClaim).not.toHaveBeenCalled();
  expect(mockMakeInvoice).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(screen.getByTestId('nfc-read-withdraw'));
    fireEvent.press(screen.getByTestId('nfc-read-withdraw'));
  });
  expect(mockClaim).toHaveBeenCalledTimes(1);
  expect(mockMakeInvoice).toHaveBeenCalledWith('first', 21, 'Voucher');
});

it.each(['confirm', 'withdraw'])('dismisses at %s without claiming', async (step) => {
  render(<NfcReadSheet visible expectedCoord="piglet" onClose={jest.fn()} />);
  await act(async () => {});
  if (step === 'withdraw')
    await act(async () => fireEvent.press(screen.getByTestId('nfc-read-resolve')));
  act(() => mockDismiss!());
  expect(mockResolve).toHaveBeenCalledTimes(step === 'confirm' ? 0 : 1);
  expect(mockClaim).not.toHaveBeenCalled();
  expect(mockMakeInvoice).not.toHaveBeenCalled();
});

it('does not expose a Withdraw action for a response from a closed session', async () => {
  let resolve!: (params: unknown) => void;
  mockResolve.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const props = { visible: true, expectedCoord: 'piglet', onClose: jest.fn() };
  const view = render(<NfcReadSheet {...props} />);
  await act(async () => {});
  act(() => {
    fireEvent.press(screen.getByTestId('nfc-read-resolve'));
  });
  view.rerender(<NfcReadSheet {...props} visible={false} />);
  await act(async () => resolve({ minWithdrawable: 21000, maxWithdrawable: 21000 }));
  expect(screen.queryByTestId('nfc-read-withdraw')).toBeNull();
  expect(mockClaim).not.toHaveBeenCalled();
});
