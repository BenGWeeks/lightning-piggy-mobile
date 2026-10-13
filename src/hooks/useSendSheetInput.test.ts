import { act, renderHook } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Alert } from '../components/BrandedAlert';
import { useSendSheetInput } from './useSendSheetInput';
import {
  AMOUNTLESS_INVOICE,
  DROPPED_CHARACTER_INVOICE,
  INVOICE_WITH_AMOUNT,
} from '../utils/bolt11TestVectors';

jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn() }));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../services/boltzService', () => ({ isBitcoinAddress: () => false }));
jest.mock('../services/onchainService', () => ({}));

function setup() {
  const opts = {
    scanned: false,
    visible: true,
    targetKey: 'alice',
    pasteTextRef: { current: DROPPED_CHARACTER_INVOICE },
    applyPasteText: jest.fn(),
    onInvalidInvoice: jest.fn(),
    setIsOnchainAddress: jest.fn(),
    setIsLnurl: jest.fn(),
    setInvoiceData: jest.fn(),
    setDecoded: jest.fn(),
    setScanned: jest.fn(),
    setSatsValue: jest.fn(),
    setLoadingBoltzFees: jest.fn(),
    setBoltzFees: jest.fn(),
    setOnchainFeeEstimate: jest.fn(),
  };
  return {
    opts,
    ...renderHook((props: typeof opts) => useSendSheetInput(props), { initialProps: opts }),
  };
}

beforeEach(() => jest.clearAllMocks());

it.each(['paste submit', 'clipboard', 'QR scan', 'deep link', 'NFC'])(
  'rejects a corrupt invoice from %s before enabling send',
  async (entry) => {
    const { result, opts } = setup();
    jest.mocked(Clipboard.getStringAsync).mockResolvedValue(DROPPED_CHARACTER_INVOICE);
    await act(async () => {
      if (entry === 'paste submit') result.current.handlePasteSubmit();
      if (entry === 'clipboard') await result.current.handlePaste();
      if (entry === 'QR scan')
        result.current.handleBarCodeScanned({ data: DROPPED_CHARACTER_INVOICE });
      if (entry === 'deep link')
        result.current.processInput(`lightning:${DROPPED_CHARACTER_INVOICE}`);
      if (entry === 'NFC')
        result.current.handleNfcContent({
          type: 'lightning-invoice',
          data: DROPPED_CHARACTER_INVOICE,
        });
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'sendSheet.invalidInvoiceTitle',
      'sendSheet.invalidInvoiceBody',
      expect.any(Array),
      expect.any(Object),
    );
    expect(opts.setScanned).not.toHaveBeenCalledWith(true);
    expect(opts.setInvoiceData).toHaveBeenCalledWith(null);
    expect(opts.setDecoded).toHaveBeenCalledWith(null);
    expect(opts.setSatsValue).toHaveBeenCalledWith('');
    expect(opts.applyPasteText).toHaveBeenCalledWith(DROPPED_CHARACTER_INVOICE);
    expect(opts.onInvalidInvoice).toHaveBeenCalledTimes(1);
  },
);

it.each([
  [INVOICE_WITH_AMOUNT, 250000],
  [AMOUNTLESS_INVOICE, null],
])(
  'accepts a valid invoice without confusing missing amount with failure',
  (invoice, amountSats) => {
    const { result, opts } = setup();
    act(() => result.current.processInput(`LIGHTNING:${invoice}`));
    expect(opts.setInvoiceData).not.toHaveBeenCalled();
    act(() => jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.());
    expect(opts.setInvoiceData).toHaveBeenCalledWith(invoice);
    expect(opts.setDecoded).toHaveBeenCalledWith(expect.objectContaining({ amountSats }));
    expect(opts.setScanned).toHaveBeenCalledWith(true);
  },
);

it('does not reopen the error on every camera frame, and allows retry after dismissal', () => {
  const { result, opts } = setup();
  act(() => {
    result.current.handleBarCodeScanned({ data: DROPPED_CHARACTER_INVOICE });
    result.current.handleBarCodeScanned({ data: DROPPED_CHARACTER_INVOICE });
  });
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(opts.setScanned).toHaveBeenCalledTimes(1);
  act(() => result.current.handleBarCodeScanned({ data: AMOUNTLESS_INVOICE }));
  expect(opts.setScanned).not.toHaveBeenCalledWith(true);
  act(() => jest.mocked(Alert.alert).mock.calls[0][2]?.[0].onPress?.());
  act(() => result.current.handleBarCodeScanned({ data: AMOUNTLESS_INVOICE }));
  act(() => jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(opts.setScanned).toHaveBeenLastCalledWith(true);
});

it('allows a fresh attempt after native dismissal of the error', () => {
  const { result, opts } = setup();
  act(() => result.current.processInput(DROPPED_CHARACTER_INVOICE));
  act(() => jest.mocked(Alert.alert).mock.calls[0][3]?.onDismiss?.());
  act(() => result.current.processInput(INVOICE_WITH_AMOUNT));
  act(() => jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(opts.setInvoiceData).toHaveBeenLastCalledWith(INVOICE_WITH_AMOUNT);
  act(() => jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(opts.setScanned).toHaveBeenLastCalledWith(true);
});

it('reopening the sheet clears a guard left by an alert that never settled', () => {
  const { result, opts } = setup();
  act(() => result.current.processInput(DROPPED_CHARACTER_INVOICE));
  // The alert was displaced without either callback firing; intake is blocked.
  act(() => result.current.processInput(INVOICE_WITH_AMOUNT));
  expect(opts.setInvoiceData).not.toHaveBeenCalledWith(INVOICE_WITH_AMOUNT);
  act(() => result.current.resetInputForOpen());
  act(() => result.current.processInput(INVOICE_WITH_AMOUNT));
  act(() => jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(opts.setInvoiceData).toHaveBeenLastCalledWith(INVOICE_WITH_AMOUNT);
  act(() => jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(opts.setScanned).toHaveBeenLastCalledWith(true);
});

it.each(['lno1qcp4256ypq', 'lightning:LNO1QCP4256YPQ'])(
  'explains that a BOLT12 offer is not supported yet (%s)',
  (offer) => {
    const { result, opts } = setup();
    act(() => result.current.processInput(offer));
    expect(Alert.alert).toHaveBeenCalledWith(
      'sendSheet.offerUnsupportedTitle',
      'sendSheet.offerUnsupportedBody',
      expect.any(Array),
      expect.any(Object),
    );
    expect(opts.setScanned).not.toHaveBeenCalledWith(true);
    expect(opts.onInvalidInvoice).toHaveBeenCalledTimes(1);
  },
);

it.each(['QR', 'NFC'])('waits for consent before accepting an LNURL from %s', (entry) => {
  const { result, opts } = setup();
  act(() => {
    if (entry === 'QR') result.current.handleBarCodeScanned({ data: 'lnurlp://example.com/pay' });
    else
      result.current.handleNfcContent({
        type: 'lightning-invoice',
        data: 'lnurlp://example.com/pay',
      });
  });
  expect(opts.setInvoiceData).not.toHaveBeenCalled();
  expect(opts.setScanned).not.toHaveBeenCalled();
  act(() => jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(opts.setInvoiceData).toHaveBeenCalledWith('lnurlp://example.com/pay');
  expect(opts.setIsLnurl).toHaveBeenCalledWith(true);
});

it.each(['cancel', 'dismiss'])(
  'keeps scanner intake inactive after %s and allows retry',
  (action) => {
    const { result, opts } = setup();
    act(() => result.current.handleBarCodeScanned({ data: 'alice@example.com' }));
    const call = jest.mocked(Alert.alert).mock.calls.at(-1)!;
    act(() => {
      if (action === 'cancel') call[2]?.[0].onPress?.();
      else call[3]?.onDismiss?.();
      call[2]?.[1].onPress?.();
    });
    expect(opts.setInvoiceData).not.toHaveBeenCalled();
    act(() => result.current.handleBarCodeScanned({ data: 'alice@example.com' }));
    act(() => jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.());
    expect(opts.setInvoiceData).toHaveBeenCalledWith('alice@example.com');
  },
);

it.each(['close', 'reopen', 'target change', 'reset', 'unmount'])(
  'invalidates an earlier confirmation on %s without releasing the new guard',
  (change) => {
    const { result, opts, rerender, unmount } = setup();
    act(() => result.current.processInput('alice@example.com'));
    const old = jest.mocked(Alert.alert).mock.calls.at(-1)!;
    if (change === 'close' || change === 'reopen') rerender({ ...opts, visible: false });
    if (change === 'reopen') rerender({ ...opts, visible: true });
    if (change === 'target change') rerender({ ...opts, targetKey: 'bob' });
    if (change === 'reset') act(() => result.current.resetInputForOpen());
    if (change === 'unmount') unmount();
    if (change !== 'close' && change !== 'unmount') {
      act(() => result.current.processInput('bob@example.com'));
    }
    const current = jest.mocked(Alert.alert).mock.calls.at(-1)!;
    act(() => {
      old[2]?.[1].onPress?.();
      old[3]?.onDismiss?.();
    });
    expect(opts.setInvoiceData).not.toHaveBeenCalled();
    if (change === 'close' || change === 'unmount') return;
    const count = jest.mocked(Alert.alert).mock.calls.length;
    act(() => result.current.processInput('carol@example.com'));
    expect(Alert.alert).toHaveBeenCalledTimes(count);
    act(() => current[2]?.[1].onPress?.());
    expect(opts.setInvoiceData).toHaveBeenCalledTimes(1);
    expect(opts.setInvoiceData).toHaveBeenCalledWith('bob@example.com');
  },
);

it('accepts a caller-vetted target (in-app contact / confirmed deep link) without a consent prompt', () => {
  const { result, opts } = setup();
  act(() => result.current.acceptVettedInput('alice@example.com'));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(opts.setInvoiceData).toHaveBeenCalledWith('alice@example.com');
  expect(opts.setScanned).toHaveBeenCalledWith(true);
});

it('ignores a vetted target once the sheet is hidden', () => {
  const { result, opts, rerender } = setup();
  rerender({ ...opts, visible: false });
  act(() => result.current.acceptVettedInput('alice@example.com'));
  expect(opts.setInvoiceData).not.toHaveBeenCalled();
});
