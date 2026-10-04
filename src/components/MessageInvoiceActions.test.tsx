import React from 'react';
import { bech32 } from 'bech32';
import { fireEvent, render } from '@testing-library/react-native';
import MessageInvoiceActions from './MessageInvoiceActions';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../styles/MessageInvoiceActions.styles', () => ({
  createMessageInvoiceActionsStyles: () => ({}),
}));
jest.mock('./BrandedToast', () => ({ show: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
// messageContent → boltzService pulls in ESM-only bitcoin deps; irrelevant here.
jest.mock('../services/boltzService', () => ({ isBitcoinAddress: () => false }));

// Real BOLT11 bech32 shape carrying a payment hash (`p` tag), decoded by the
// production `extractInvoice`.
const validInvoice = bech32.encode(
  'lnbc1u',
  [...Array(7).fill(0), 1, 1, 20, ...bech32.toWords(Buffer.alloc(32, 1)), ...Array(104).fill(0)],
  2000,
);

function renderActions(bolt11: string) {
  const onPayInvoice = jest.fn();
  const ui = render(
    <MessageInvoiceActions bolt11={bolt11} onPayInvoice={onPayInvoice} testIdPrefix="c" id="1" />,
  );
  return { ui, onPayInvoice };
}

test('a decodable invoice is payable', () => {
  const { ui, onPayInvoice } = renderActions(validInvoice);
  fireEvent.press(ui.getByTestId('c-pay-1'));
  expect(onPayInvoice).toHaveBeenCalledWith(validInvoice);
});

test('an undecodable invoice offers no Pay button, only QR and copy', () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const { ui, onPayInvoice } = renderActions(`lnbc1u${'q'.repeat(80)}`);
  expect(ui.queryByTestId('c-pay-1')).toBeNull();
  expect(ui.getByTestId('c-invoice-qr-toggle-1')).toBeTruthy();
  expect(ui.getByTestId('c-invoice-copy-1')).toBeTruthy();
  expect(onPayInvoice).not.toHaveBeenCalled();
});
