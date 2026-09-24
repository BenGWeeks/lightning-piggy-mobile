import React from 'react';
import { ActivityIndicator } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import ReceiveSheet from './ReceiveSheet';

// Boundary test for the real ReceiveSheet: native sheet/QR, contexts and child
// sheets are stubbed; the sheet's own open / wallet-switch effects and invoice
// generation run for real. HomeSheets retains the sheet across opens, so a
// slow address/invoice request from one open or wallet must never land on the
// QR of a later one.

jest.mock('@gorhom/bottom-sheet', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  const Pass = ({ children }: { children?: React.ReactNode }) =>
    R.createElement(RN.View, null, children);
  return {
    BottomSheetModal: R.forwardRef(function Modal(
      { children }: { children?: React.ReactNode },
      ref: React.Ref<unknown>,
    ) {
      R.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
      return R.createElement(RN.View, null, children);
    }),
    BottomSheetBackdrop: () => null,
    BottomSheetView: Pass,
  };
});
jest.mock('react-native-qrcode-svg', () => {
  const { Text } = jest.requireActual('react-native');
  return ({ value }: { value: string }) => <Text testID="receive-qr">{value}</Text>;
});
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../styles/ReceiveSheet.styles', () => ({
  createReceiveSheetStyles: () => new Proxy({}, { get: () => ({}) }),
}));

type Wallet = { id: string; alias: string; walletType: 'onchain' | 'nwc'; isConnected: boolean };
const mockWallets: Wallet[] = [
  { id: 'A', alias: 'Alpha', walletType: 'onchain', isConnected: true },
  { id: 'B', alias: 'Bravo', walletType: 'onchain', isConnected: true },
  { id: 'LA', alias: 'Lima', walletType: 'nwc', isConnected: true },
  { id: 'LB', alias: 'Lynx', walletType: 'nwc', isConnected: true },
];
let mockActiveWalletId = 'A';

// Per-wallet deferred responses, resolved explicitly by each test.
const mockPending: Record<string, ((value: string) => void)[]> = {};
const deferFor = (id: string) =>
  new Promise<string>((resolve) => (mockPending[id] ??= []).push(resolve));
const resolveFor = async (id: string, value: string) => {
  const waiting = mockPending[id] ?? [];
  expect(waiting.length).toBeGreaterThan(0);
  delete mockPending[id];
  await act(async () => waiting.forEach((resolve) => resolve(value)));
};

const mockGetReceiveAddress = jest.fn((id: string) => deferFor(id));
const mockMakeInvoice = jest.fn((id: string) => deferFor(id));
const mockExpectPayment = jest.fn();
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({
    makeInvoiceForWallet: mockMakeInvoice,
    refreshBalanceForWallet: jest.fn(),
    activeWalletId: mockActiveWalletId,
    activeWallet: mockWallets.find((w) => w.id === mockActiveWalletId),
    wallets: mockWallets,
    currency: 'USD',
    getReceiveAddress: mockGetReceiveAddress,
    expectPayment: mockExpectPayment,
  }),
  useWalletLive: () => ({ btcPrice: null, lastIncomingPayment: null }),
}));
jest.mock('../utils/bolt11', () => ({ paymentHashFromBolt11: (inv: string) => `hash-${inv}` }));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ sendDirectMessage: jest.fn() }),
  useNostrContacts: () => ({ contacts: [] }),
}));
jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => new Proxy({}, { get: () => '#000' }),
}));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (k: string) => k }));
jest.mock('./BrandedToast', () => ({ show: jest.fn() }));
jest.mock('../services/fiatService', () => ({ satsToFiat: () => 0, formatFiat: () => '' }));
jest.mock('./FriendPickerSheet', () => () => null);
jest.mock('./BoltzReceiveSheet', () => () => null);
let mockConfirmAmount: ((sats: number) => void) | null = null;
jest.mock('./AmountEntryScreen', () => (props: { onConfirm: (sats: number) => void }) => {
  mockConfirmAmount = props.onConfirm;
  return null;
});

const onClose = jest.fn();
const qrValue = () => screen.queryByTestId('receive-qr')?.props.children ?? null;

beforeEach(() => {
  mockActiveWalletId = 'A';
  mockConfirmAmount = null;
  for (const id of Object.keys(mockPending)) delete mockPending[id];
  jest.clearAllMocks();
});

// Open on wallet A, close, reopen on wallet B — with A's request still pending.
function openAThenReopenB() {
  const view = render(<ReceiveSheet visible onClose={onClose} />);
  view.rerender(<ReceiveSheet visible={false} onClose={onClose} />);
  mockActiveWalletId = 'B';
  view.rerender(<ReceiveSheet visible onClose={onClose} />);
  expect(mockGetReceiveAddress).toHaveBeenCalledWith('A');
  expect(mockGetReceiveAddress).toHaveBeenCalledWith('B');
}

it('drops a delayed wallet-A address that resolves after reopening on wallet B', async () => {
  openAThenReopenB();
  await resolveFor('B', 'bc1qbravo000000');
  expect(qrValue()).toBe('bitcoin:bc1qbravo000000');
  await resolveFor('A', 'bc1qalpha000000');
  expect(qrValue()).toBe('bitcoin:bc1qbravo000000');
});

it("does not show wallet A's address while wallet B's is still loading", async () => {
  openAThenReopenB();
  await resolveFor('A', 'bc1qalpha000000');
  expect(qrValue()).toBeNull();
  await resolveFor('B', 'bc1qbravo000000');
  expect(qrValue()).toBe('bitcoin:bc1qbravo000000');
});

it("drops the previous wallet's late address after a dropdown switch in one open", async () => {
  render(<ReceiveSheet visible onClose={onClose} />);
  fireEvent.press(screen.getByTestId('receive-wallet-dropdown-toggle'));
  fireEvent.press(screen.getByTestId('receive-wallet-option-B'));
  await resolveFor('B', 'bc1qbravo000000');
  await resolveFor('A', 'bc1qalpha000000');
  expect(qrValue()).toBe('bitcoin:bc1qbravo000000');
});

it('drops a delayed invoice minted in a previous open for another wallet', async () => {
  mockActiveWalletId = 'LA';
  const view = render(<ReceiveSheet visible onClose={onClose} />);
  act(() => mockConfirmAmount?.(1000));
  expect(mockMakeInvoice).toHaveBeenCalledWith('LA', 1000, expect.any(String));

  view.rerender(<ReceiveSheet visible={false} onClose={onClose} />);
  mockActiveWalletId = 'LB';
  view.rerender(<ReceiveSheet visible onClose={onClose} />);
  act(() => mockConfirmAmount?.(2000));
  expect(mockMakeInvoice).toHaveBeenCalledWith('LB', 2000, expect.any(String));

  await resolveFor('LB', 'lnbc-bravo');
  await resolveFor('LA', 'lnbc-alpha');
  expect(qrValue()).toBe('lnbc-bravo');
  // The stale invoice was never shown, so it is not watched for payment.
  expect(mockExpectPayment).toHaveBeenCalledTimes(1);
  expect(mockExpectPayment).toHaveBeenCalledWith('LB', 'hash-lnbc-bravo', 2000);
});

it('a stale invoice request does not hide the spinner of the current one', async () => {
  mockActiveWalletId = 'LA';
  const view = render(<ReceiveSheet visible onClose={onClose} />);
  act(() => mockConfirmAmount?.(1000));
  view.rerender(<ReceiveSheet visible={false} onClose={onClose} />);
  mockActiveWalletId = 'LB';
  view.rerender(<ReceiveSheet visible onClose={onClose} />);
  act(() => mockConfirmAmount?.(2000));

  await resolveFor('LA', 'lnbc-alpha');
  expect(qrValue()).toBeNull();
  expect(screen.UNSAFE_queryByType(ActivityIndicator)).not.toBeNull();
  await resolveFor('LB', 'lnbc-bravo');
  expect(qrValue()).toBe('lnbc-bravo');
});
