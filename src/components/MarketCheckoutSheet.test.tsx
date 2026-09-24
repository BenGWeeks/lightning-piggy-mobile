import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import MarketCheckoutSheet from './MarketCheckoutSheet';
import Toast from './BrandedToast';
import { useMarketCheckout } from '../hooks/useMarketCheckout';
import { useShippingOptions } from '../hooks/useShippingOptions';
import { getBtcPrice } from '../services/fiatService';
import type { MarketProduct } from '../data/marketProducts';
import type { MarketCheckoutTarget } from '../utils/marketCheckout';
import type { ShippingOption } from '../utils/marketShipping';

jest.mock('@gorhom/bottom-sheet', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    BottomSheetModal: R.forwardRef(
      (props: { children: React.ReactNode }, ref: React.Ref<unknown>) => {
        R.useImperativeHandle(ref, () => ({ present: () => {}, dismiss: () => {} }));
        return R.createElement(View, null, props.children);
      },
    ),
    BottomSheetScrollView: (props: { children: React.ReactNode }) =>
      R.createElement(View, null, props.children),
    BottomSheetBackdrop: () => null,
  };
});
jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../styles/MarketCheckoutSheet.styles', () => ({
  createMarketCheckoutSheetStyles: () => ({}),
}));
jest.mock('../styles/MarketShippingSection.styles', () => ({
  createMarketShippingSectionStyles: () => ({}),
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('./BrandedToast', () => ({ __esModule: true, default: { show: jest.fn() } }));
jest.mock('./CountryPickerSheet', () => () => null);
jest.mock('../data/countries', () => ({
  deviceCountryCode: () => 'GB',
  countryName: (code: string) => code,
}));
jest.mock('../hooks/useMarketCheckout', () => ({ useMarketCheckout: jest.fn() }));
jest.mock('../hooks/useShippingOptions', () => ({ useShippingOptions: jest.fn() }));
jest.mock('../services/fiatService', () => ({ getBtcPrice: jest.fn() }));

const vendorPubkey = 'b'.repeat(64);
const product: MarketProduct = {
  id: 'catalogue-id',
  title: 'Test Item',
  description: 'x',
  priceSats: 21,
  priceFiatLabel: '21 sats',
  image: '',
  sellerName: 'Big Piggy (TEST)',
  url: 'https://example.com',
  featured: false,
};
const physical: MarketCheckoutTarget = {
  vendorPubkey,
  listingDTag: 'seller-listing',
  fulfilment: 'physical',
};
const ukOption: ShippingOption = {
  coordinate: `30406:${vendorPubkey}:uk`,
  pubkey: vendorPubkey,
  dTag: 'uk',
  title: 'Royal Mail',
  baseAmount: 5,
  currency: 'GBP',
  countries: ['GB'],
  createdAt: 1,
};

const placeOrder = jest.fn();
const reset = jest.fn();
const retry = jest.fn();

function setShipping(status: 'idle' | 'loading' | 'ready' | 'error', options: ShippingOption[]) {
  (useShippingOptions as jest.Mock).mockReturnValue({ status, options, retry });
}

function renderSheet(checkout: MarketCheckoutTarget = physical) {
  return render(
    <MarketCheckoutSheet
      visible
      onClose={jest.fn()}
      product={product}
      checkout={checkout}
      sellerName="Big Piggy (TEST)"
      onRequestSignIn={jest.fn()}
      onPlaced={jest.fn()}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  placeOrder.mockResolvedValue(undefined);
  (useMarketCheckout as jest.Mock).mockReturnValue({
    status: 'idle',
    error: null,
    isPlacing: false,
    canOrder: true,
    placeOrder,
    reset,
  });
});

test('a physical product whose shipping fetch failed or came back empty cannot be ordered', () => {
  setShipping('error', []);
  const ui = renderSheet();
  expect(useShippingOptions).toHaveBeenCalledWith(vendorPubkey, true, 'physical');
  expect(ui.getByTestId('market-shipping-retry')).toBeTruthy();
  fireEvent.press(ui.getByTestId('market-checkout-place-order'));
  expect(placeOrder).not.toHaveBeenCalled();
});

test('a physical product never submits without shipping even if the hook reports ready+empty', () => {
  setShipping('ready', []);
  const ui = renderSheet();
  fireEvent.press(ui.getByTestId('market-checkout-place-order'));
  expect(placeOrder).not.toHaveBeenCalled();
});

test('a no-shipping product orders the seller listing id, once, on a double tap', async () => {
  setShipping('ready', []);
  let resolvePlace: () => void = () => {};
  placeOrder.mockReturnValue(new Promise<void>((resolve) => (resolvePlace = resolve)));
  const ui = renderSheet({ ...physical, fulfilment: 'none' });
  expect(ui.queryByTestId('market-shipping-address-note')).toBeNull();
  const button = ui.getByTestId('market-checkout-place-order');
  await act(async () => {
    fireEvent.press(button);
    fireEvent.press(button);
  });
  await act(async () => resolvePlace());
  expect(placeOrder).toHaveBeenCalledTimes(1);
  expect(placeOrder).toHaveBeenCalledWith({
    vendorPubkey,
    dTag: 'seller-listing',
    priceSats: 21,
    quantity: 1,
    shipping: undefined,
  });
});

describe('physical product with merchant shipping options', () => {
  beforeEach(() => {
    setShipping('ready', [ukOption]);
    (getBtcPrice as jest.Mock).mockResolvedValue(50000);
  });

  // Let the sheet's spot-rate fetch commit before asserting.
  async function renderSettled() {
    const ui = renderSheet();
    await act(async () => {});
    return ui;
  }

  test('explains the address is collected in chat', async () => {
    const ui = await renderSettled();
    expect(ui.getByTestId('market-shipping-address-note')).toHaveTextContent(
      'market.shipping.addressInChat',
    );
  });

  test('blocks submit until an option is chosen', async () => {
    const ui = await renderSettled();
    fireEvent.press(ui.getByTestId('market-checkout-place-order'));
    expect(placeOrder).not.toHaveBeenCalled();
  });

  test('re-quotes at submit and refuses to sign when the rate moved', async () => {
    (getBtcPrice as jest.Mock).mockResolvedValueOnce(50000).mockResolvedValue(60000);
    const ui = await renderSettled();
    fireEvent.press(ui.getByTestId('market-shipping-option-uk'));
    await waitFor(() =>
      expect(ui.getByTestId('market-checkout-shipping')).toHaveTextContent('market.sats'),
    );
    await act(async () => {
      fireEvent.press(ui.getByTestId('market-checkout-place-order'));
    });
    expect(getBtcPrice).toHaveBeenLastCalledWith('GBP', { allowStale: false });
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ text1: 'market.checkout.rateUpdated' }),
    );
    expect(placeOrder).not.toHaveBeenCalled();
  });

  test('signs the shown shipping cost when the fresh rate matches', async () => {
    const ui = await renderSettled();
    fireEvent.press(ui.getByTestId('market-shipping-option-uk'));
    await waitFor(() =>
      expect(ui.getByTestId('market-checkout-shipping')).toHaveTextContent('market.sats'),
    );
    await act(async () => {
      fireEvent.press(ui.getByTestId('market-checkout-place-order'));
    });
    expect(placeOrder).toHaveBeenCalledWith({
      vendorPubkey,
      dTag: 'seller-listing',
      priceSats: 21,
      quantity: 1,
      // £5 at £50,000/BTC.
      shipping: { coordinate: ukOption.coordinate, costSats: 10000, title: 'Royal Mail' },
    });
  });
});
