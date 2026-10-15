/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must require lazily */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import SellerOrderPanel from './SellerOrderPanel';
import { useSellerOrderQuote } from '../hooks/useSellerOrderQuote';
import { useSellerInvoice } from '../hooks/useSellerInvoice';
import type { ParsedOrderEvent } from '../utils/orderEvents';
import type { SellerOrderQuote } from '../utils/sellerOrderQuote';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => {
  const t = (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key);
  return { useTranslation: () => t, useLocale: () => ({ t, locale: 'en', formatLocale: 'en' }) };
});
jest.mock('../contexts/NostrContext', () => ({ useNostr: () => ({ pubkey: 'a'.repeat(64) }) }));
jest.mock('../hooks/useSellerOrderQuote', () => ({ useSellerOrderQuote: jest.fn() }));
jest.mock('../hooks/useSellerInvoice', () => ({
  useSellerInvoice: jest.fn(),
  SellerInvoiceError: class extends Error {},
}));
jest.mock('./SellerInvoiceSheet', () => {
  const { Text } = require('react-native');
  const MockSheet = (p: { visible: boolean }) =>
    p.visible ? <Text testID="sheet-open">open</Text> : null;
  return MockSheet;
});
jest.mock('./FiatAmount', () => () => null);
jest.mock('./BrandedToast', () => ({ Toast: { show: jest.fn() } }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const ME = 'a'.repeat(64);
const order = (pubkey = ME): ParsedOrderEvent => ({
  kind: 16,
  type: 'order',
  orderId: 'o-1',
  amountSats: 4000,
  items: [{ ref: `30402:${pubkey}:mug`, quantity: 2 }],
  address: '1 High St',
  message: '',
});
const quote: SellerOrderQuote = {
  problem: null,
  lines: [
    {
      ref: `30402:${ME}:mug`,
      dTag: 'mug',
      title: 'Mug',
      quantity: 2,
      unitAmount: 2100,
      currency: 'SATS',
      unitSats: 2100,
      lineSats: 4200,
      stock: null,
      overStock: false,
    },
  ],
  shipping: null,
  shippingMissing: false,
  subtotalSats: 4200,
  shippingSats: 0,
  totalSats: 4200,
  fiatTotal: null,
  buyerAmountSats: 4000,
  amountMismatch: true,
};

beforeEach(() => {
  (useSellerOrderQuote as jest.Mock).mockReturnValue({ quote, loading: false, titles: new Map() });
  (useSellerInvoice as jest.Mock).mockReturnValue({
    record: null,
    sending: false,
    checking: false,
    sendInvoice: jest.fn(),
    checkPaid: jest.fn(),
    markPaid: jest.fn(),
  });
});

it('shows the recomputed total but blocks invoicing an unapproved amount', () => {
  const ui = render(<SellerOrderPanel order={order()} buyerPubkey={'b'.repeat(64)} id="x" />);
  expect(ui.getByTestId('seller-order-total-x')).toHaveTextContent(/4,200/);
  expect(ui.getByTestId('seller-order-mismatch-x')).toBeTruthy();
  expect(ui.getByTestId('seller-order-address-x')).toHaveTextContent(/1 High St/);
  expect(ui.getByTestId('seller-order-status-x')).toHaveTextContent('orderStatus.needsInvoice');
  fireEvent.press(ui.getByTestId('seller-order-send-invoice-x'));
  expect(ui.queryByTestId('sheet-open')).toBeNull();
});

it("renders nothing for an order naming someone else's listing", () => {
  const ui = render(
    <SellerOrderPanel order={order('c'.repeat(64))} buyerPubkey={'b'.repeat(64)} id="x" />,
  );
  expect(ui.toJSON()).toBeNull();
});

it.each(['GB', 'United Kingdom'])('renders the full country name for address ending %s', (end) => {
  const ui = render(
    <SellerOrderPanel
      order={{ ...order(), address: `Testy McTestface\n1 Nowhere Lane\nFaketown\nZZ1 1ZZ\n${end}` }}
      buyerPubkey={'b'.repeat(64)}
      id="x"
    />,
  );
  expect(ui.getByTestId('seller-order-address-x')).toHaveTextContent(
    /Testy McTestface\s+1 Nowhere Lane\s+Faketown\s+ZZ1 1ZZ\s+United Kingdom$/,
  );
});

it('offers Mark paid once the chosen wallet saw the invoice paid', () => {
  (useSellerInvoice as jest.Mock).mockReturnValue({
    record: {
      orderId: 'o-1',
      walletId: 'w',
      paymentHash: 'h',
      bolt11: 'b',
      amountSats: 4200,
      sentAt: 1,
      paidAt: 2,
    },
    sending: false,
    checking: false,
    sendInvoice: jest.fn(),
    checkPaid: jest.fn(),
    markPaid: jest.fn(),
  });
  const ui = render(<SellerOrderPanel order={order()} buyerPubkey={'b'.repeat(64)} id="x" />);
  expect(ui.getByTestId('seller-order-status-x')).toHaveTextContent('orderStatus.paid');
  expect(ui.getByTestId('seller-order-mark-paid-x')).toBeTruthy();
});

it('opens invoice confirmation when the computed total matches the placed amount', () => {
  const ui = render(
    <SellerOrderPanel
      order={{ ...order(), amountSats: 4200 }}
      buyerPubkey={'b'.repeat(64)}
      id="x"
    />,
  );
  fireEvent.press(ui.getByTestId('seller-order-send-invoice-x'));
  expect(ui.getByTestId('sheet-open')).toBeTruthy();
});

it.each([true, false])(
  'offers replacement of an expired invoice only with its local wallet record: %s',
  (hasRecord) => {
    (useSellerInvoice as jest.Mock).mockReturnValue({
      sending: false,
      checking: false,
      checkPaid: jest.fn(),
      sendInvoice: jest.fn(),
      markPaid: jest.fn(),
      record: hasRecord ? { bolt11: 'old-invoice', paymentHash: 'h', amountSats: 4200 } : null,
    });
    const placed = { ...order(), amountSats: 4200 };
    const ui = render(
      <SellerOrderPanel
        order={placed}
        buyerPubkey={'b'.repeat(64)}
        id="x"
        thread={{
          placed,
          orderId: 'o-1',
          role: 'seller',
          placedAt: 1,
          cancelled: false,
          invoices: [],
          invoice: { bolt11: 'old-invoice', expiresAt: 1, at: 1 },
        }}
      />,
    );
    expect(Boolean(ui.queryByTestId('seller-order-send-invoice-x'))).toBe(hasRecord);
  },
);

it.each([true, false])(
  'offers retry for an unexpired self-echo only while delivery is pending: %s',
  (deliveryPending) => {
    (useSellerInvoice as jest.Mock).mockReturnValue({
      sending: false,
      checking: false,
      checkPaid: jest.fn(),
      sendInvoice: jest.fn(),
      markPaid: jest.fn(),
      record: { bolt11: 'pending-invoice', paymentHash: 'h', amountSats: 4200, deliveryPending },
    });
    const placed = { ...order(), amountSats: 4200 };
    const ui = render(
      <SellerOrderPanel
        order={placed}
        buyerPubkey={'b'.repeat(64)}
        id="x"
        thread={{
          placed,
          orderId: 'o-1',
          role: 'seller',
          placedAt: 1,
          cancelled: false,
          invoices: [],
          invoice: {
            bolt11: 'pending-invoice',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            at: 1,
          },
        }}
      />,
    );
    expect(Boolean(ui.queryByTestId('seller-order-send-invoice-x'))).toBe(deliveryPending);
    if (deliveryPending) {
      fireEvent.press(ui.getByTestId('seller-order-send-invoice-x'));
      expect(ui.getByTestId('sheet-open')).toBeTruthy();
    }
  },
);
