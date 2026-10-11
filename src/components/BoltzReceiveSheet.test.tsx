import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import BoltzReceiveSheet from './BoltzReceiveSheet';
import { getSubmarineSwapFees, type SwapFees } from '../services/boltzService';

// Boundary test for the real BoltzReceiveSheet: native sheet/QR, contexts and
// services are stubbed; the sheet's open/reset effect, the real fee hook and
// the confirmation flow run for real. HomeSheets retains the sheet across
// opens, so a confirmation from an earlier open must never touch a later one.

jest.mock('./AccessibleBottomSheetModal', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  return {
    BottomSheetModal: R.forwardRef(function Modal(
      { children }: { children?: React.ReactNode },
      ref: React.Ref<unknown>,
    ) {
      R.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
      return R.createElement(RN.View, null, children);
    }),
  };
});
jest.mock('@gorhom/bottom-sheet', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  return {
    BottomSheetBackdrop: () => null,
    BottomSheetView: ({ children }: { children?: React.ReactNode }) =>
      R.createElement(RN.View, null, children),
  };
});
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
}));
jest.mock('./BrandedToast', () => ({ show: jest.fn() }));
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({
    wallets: [{ id: 'LN', alias: 'Lima', walletType: 'nwc', isConnected: true }],
    makeInvoiceForWallet: jest.fn(() => new Promise(() => {})),
    refreshBalanceForWallet: jest.fn(),
    fetchTransactionsForWallet: jest.fn(),
    addPendingTransaction: jest.fn(),
    currency: 'USD',
  }),
  useWalletLive: () => ({ btcPrice: null }),
}));
jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => new Proxy({}, { get: () => '#000' }),
}));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (k: string) => k }));
jest.mock('../styles/BoltzReceiveSheet.styles', () => ({
  createBoltzReceiveSheetStyles: () => new Proxy({}, { get: () => ({}) }),
}));
jest.mock('../services/fiatService', () => ({ satsToFiat: () => 0, formatFiat: () => '' }));
jest.mock('../services/boltzService', () => ({
  BOLTZ_MIN_SATS: 25_000,
  BOLTZ_MAX_SATS: 25_000_000,
  getSubmarineSwapFees: jest.fn(),
  isQuoteChangedError: () => false,
  createSubmarineSwapForward: jest.fn(),
  watchSubmarineSwapStatus: jest.fn(),
}));
jest.mock('../services/swapRecoveryService', () => ({}));
jest.mock('../services/onchainService', () => ({ getBlockHeight: jest.fn() }));
jest.mock('../services/walletStorageService', () => ({
  getActivePubkey: () => null,
  getDefaultOnchainWalletId: jest.fn(),
}));
let mockConfirmAmount: ((sats: number) => void) | null = null;
jest.mock('./AmountEntryScreen', () => (props: { onConfirm: (sats: number) => void }) => {
  mockConfirmAmount = props.onConfirm;
  return null;
});

const fees: SwapFees = { percentage: 0.1, minerFee: 300, minAmount: 25000, maxAmount: 1000000 };
const pending: ((f: SwapFees) => void)[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  pending.length = 0;
  mockConfirmAmount = null;
  jest
    .mocked(getSubmarineSwapFees)
    .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
});

it("keeps a reopened sheet's in-flight create when an earlier open's fee request settles", async () => {
  const onClose = jest.fn();
  const view = render(<BoltzReceiveSheet visible onClose={onClose} walletId="LN" />);
  // Open #1: confirm while its fee schedule is still loading → refetch [1].
  await act(async () => {
    void mockConfirmAmount!(30000);
  });
  expect(screen.getByText('boltzReceive.creating')).toBeTruthy();
  // Android back closes mid-create; the user reopens and confirms again.
  view.rerender(<BoltzReceiveSheet visible={false} onClose={onClose} walletId="LN" />);
  view.rerender(<BoltzReceiveSheet visible onClose={onClose} walletId="LN" />);
  await act(async () => {
    void mockConfirmAmount!(40000);
  });
  expect(screen.getByText('boltzReceive.creating')).toBeTruthy();
  expect(pending).toHaveLength(4); // open #1, its confirm, open #2, its confirm
  // Open #1's confirmation refetch settles now — stale for this open.
  await act(async () => pending[1](fees));
  expect(screen.getByText('boltzReceive.creating')).toBeTruthy();
});
