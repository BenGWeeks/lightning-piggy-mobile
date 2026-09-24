import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import SendSheet from './SendSheet';

// Boundary test for the real SendSheet: native sheet/camera, contexts and
// payment services are stubbed; the sheet's own open effect, tab state and
// paste field run for real. Guards the #1092 lazy-mount regression where the
// first open ran before useCameraPermissions() resolved and stuck on Paste.

type Permission = { granted: boolean } | null;
let mockPermission: Permission = null;
let mockSetPermission: ((p: Permission) => void) | null = null;
jest.mock('expo-camera', () => {
  const { useState } = jest.requireActual('react');
  return {
    useCameraPermissions: () => {
      const [p, setP] = useState(mockPermission);
      mockSetPermission = setP;
      return [p, jest.fn()];
    },
  };
});

// A native keystroke queued here is delivered from the paste field's layout
// effect: after React commits the next render but BEFORE that commit's passive
// effects flush — the window where the uncontrolled field's native text (and
// pasteTextRef) is ahead of `pasteText` state.
let mockNativeKeystroke: string | null = null;
jest.mock('@gorhom/bottom-sheet', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  const Pass = ({ children }: { children?: React.ReactNode }) =>
    R.createElement(RN.View, null, children);
  function TextInput(props: { testID?: string; onChangeText?: (v: string) => void }) {
    R.useLayoutEffect(() => {
      if (mockNativeKeystroke === null || props.testID !== 'send-paste-input') return;
      const text = mockNativeKeystroke;
      mockNativeKeystroke = null;
      props.onChangeText?.(text);
    });
    return R.createElement(RN.TextInput, props);
  }
  return {
    BottomSheetModal: R.forwardRef(function Modal(
      { children }: { children?: React.ReactNode },
      ref: React.Ref<unknown>,
    ) {
      R.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() }));
      return R.createElement(RN.View, null, children);
    }),
    BottomSheetBackdrop: () => null,
    BottomSheetTextInput: TextInput,
    BottomSheetScrollView: Pass,
    BottomSheetView: Pass,
  };
});

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
// Factories are hoisted above module-scope consts, so styles are built inline.
jest.mock('../styles/SendSheet.styles', () => ({
  createSendSheetStyles: () => new Proxy({}, { get: () => ({}) }),
}));
jest.mock('../styles/SendModeTabs.styles', () => ({
  createSendModeTabsStyles: () => new Proxy({}, { get: () => ({}) }),
}));

const mockWallet = {
  payInvoiceForWallet: jest.fn(),
  refreshBalanceForWallet: jest.fn(),
  fetchTransactionsForWallet: jest.fn(),
  addPendingTransaction: jest.fn(),
  activeWalletId: 'w1',
  wallets: [{ id: 'w1', alias: 'Piggy', isConnected: true, balance: 1000 }],
  currency: 'USD',
};
jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => mockWallet,
  useWalletLive: () => ({ btcPrice: null }),
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ signZapRequest: jest.fn() }),
  useNostrContacts: () => ({ contacts: [] }),
}));
jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => new Proxy({}, { get: () => '#000' }),
}));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (k: string) => k }));
jest.mock('./BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('./BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('./PaymentProgressOverlay', () => () => null);
jest.mock('./AmountEntryScreen', () => () => null);
jest.mock('./SendAmountSection', () => () => null);
jest.mock('./SendNfcPane', () => {
  const { Text } = jest.requireActual('react-native');
  return () => <Text testID="mock-nfc-pane">nfc</Text>;
});
jest.mock('./SendScanPane', () => {
  const { Text } = jest.requireActual('react-native');
  return ({ permissionGranted }: { permissionGranted: boolean }) => (
    <Text testID={permissionGranted ? 'send-scan-camera' : 'send-scan-grant-permission'}>scan</Text>
  );
});
jest.mock('../hooks/useSendSheetLnurl', () => ({ useSendSheetLnurl: () => undefined }));
const mockProcessInput = jest.fn();
jest.mock('../hooks/useSendSheetInput', () => ({
  useSendSheetInput: () => ({
    processInput: mockProcessInput,
    handleBarCodeScanned: jest.fn(),
    handleNfcContent: jest.fn(),
    handlePaste: jest.fn(),
    handlePasteSubmit: jest.fn(),
  }),
}));
jest.mock('../services/fiatService', () => ({ satsToFiatString: () => '' }));
jest.mock('../services/sendThresholdService', () => ({
  getSendThreshold: jest.fn(),
  shouldConfirmSend: jest.fn(),
}));
jest.mock('../services/lnurlService', () => ({ fetchInvoice: jest.fn() }));
jest.mock('../services/boltzService', () => ({}));
jest.mock('../services/onchainService', () => ({}));
jest.mock('../services/nostrService', () => ({ npubEncode: jest.fn() }));
jest.mock('../services/zapCounterpartyStorage', () => ({ recordOutgoing: jest.fn() }));
jest.mock('../services/nwcService', () => ({
  isReplyTimeoutError: jest.fn(),
  isConnectionError: jest.fn(),
}));
jest.mock('../services/swapRecoveryService', () => ({}));
jest.mock('../utils/reverseSwapSend', () => ({
  executeReverseSwap: jest.fn(),
  isSwapSettlingError: jest.fn(),
}));
jest.mock('../utils/perfLog', () => ({ perfLog: jest.fn() }));

const onClose = jest.fn();
const resolvePermission = (p: Permission) => act(() => mockSetPermission?.(p));
const selectedTab = (id: string) =>
  screen.getByTestId(id).props.accessibilityState?.selected === true;

beforeEach(() => {
  jest.useFakeTimers();
  mockPermission = null;
  mockSetPermission = null;
  mockNativeKeystroke = null;
  mockProcessInput.mockClear();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

it('lazy first open lands on Scan once camera permission resolves granted', () => {
  render(<SendSheet visible onClose={onClose} />);
  expect(screen.getByTestId('send-paste-input')).toBeTruthy();
  resolvePermission({ granted: true });
  expect(screen.getByTestId('send-scan-camera')).toBeTruthy();
  expect(screen.queryByTestId('send-paste-input')).toBeNull();
  expect(selectedTab('send-tab-scan')).toBe(true);
});

it('stays on Paste when permission resolves denied', () => {
  render(<SendSheet visible onClose={onClose} />);
  resolvePermission({ granted: false });
  expect(screen.getByTestId('send-paste-input')).toBeTruthy();
  expect(selectedTab('send-tab-input')).toBe(true);
});

it('keeps Paste and the prefilled address for an initialAddress open', () => {
  render(<SendSheet visible onClose={onClose} initialAddress="piggy@example.com" />);
  resolvePermission({ granted: true });
  const input = screen.getByTestId('send-paste-input');
  expect(input.props.defaultValue).toBe('piggy@example.com');
  act(() => jest.runOnlyPendingTimers());
  expect(mockProcessInput).toHaveBeenCalledWith('piggy@example.com');
});

it("respects the user's tab choice made before permission resolves", () => {
  render(<SendSheet visible onClose={onClose} />);
  fireEvent.press(screen.getByTestId('send-tab-nfc'));
  resolvePermission({ granted: true });
  expect(screen.getByTestId('mock-nfc-pane')).toBeTruthy();
  expect(selectedTab('send-tab-nfc')).toBe(true);
});

it('does not switch tab or reset typed text when permission resolves mid-entry', () => {
  render(<SendSheet visible onClose={onClose} />);
  const input = screen.getByTestId('send-paste-input');
  fireEvent.changeText(input, 'lnbc1partial');
  resolvePermission({ granted: true });
  const after = screen.getByTestId('send-paste-input');
  // Same native instance (no remount-key bump) and state still holds the text.
  expect(after).toBe(input);
  expect(screen.getByTestId('send-paste-go').props.accessibilityState?.disabled).toBe(false);
});

it('keeps Paste for a keystroke that lands before its state commits (ref ahead of state)', () => {
  render(<SendSheet visible onClose={onClose} />);
  const input = screen.getByTestId('send-paste-input');
  // The resolution render commits with empty `pasteText`; the keystroke then
  // arrives before the permission effect flushes, so only the ref has it.
  mockNativeKeystroke = 'lnbc1partial';
  resolvePermission({ granted: true });
  expect(mockNativeKeystroke).toBeNull();
  expect(screen.getByTestId('send-paste-input')).toBe(input);
  expect(selectedTab('send-tab-input')).toBe(true);
  expect(screen.getByTestId('send-paste-go').props.accessibilityState?.disabled).toBe(false);
});

it('cancels the deferred initialAddress prefill when the sheet closes first', () => {
  const view = render(<SendSheet visible onClose={onClose} initialAddress="a@example.com" />);
  view.rerender(<SendSheet visible={false} onClose={onClose} initialAddress="a@example.com" />);
  act(() => jest.runOnlyPendingTimers());
  expect(mockProcessInput).not.toHaveBeenCalled();
});

it('a previous open never prefills over a reopen with another address', () => {
  const view = render(<SendSheet visible onClose={onClose} initialAddress="a@example.com" />);
  view.rerender(<SendSheet visible={false} onClose={onClose} />);
  view.rerender(<SendSheet visible onClose={onClose} initialAddress="b@example.com" />);
  act(() => jest.runOnlyPendingTimers());
  expect(mockProcessInput.mock.calls).toEqual([['b@example.com']]);
});

it('a previous prefill never processes into a plain reopen', () => {
  const view = render(<SendSheet visible onClose={onClose} initialAddress="a@example.com" />);
  view.rerender(<SendSheet visible={false} onClose={onClose} />);
  view.rerender(<SendSheet visible onClose={onClose} />);
  act(() => jest.runOnlyPendingTimers());
  expect(mockProcessInput).not.toHaveBeenCalled();
  expect(screen.getByTestId('send-paste-input').props.defaultValue).toBe('');
});

it('opens straight on Scan when permission was already granted at mount', () => {
  mockPermission = { granted: true };
  render(<SendSheet visible onClose={onClose} />);
  expect(screen.getByTestId('send-scan-camera')).toBeTruthy();
});
