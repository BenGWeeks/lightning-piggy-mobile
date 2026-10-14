import React from 'react';
import { FlatList } from 'react-native';
import { MARKET_PRODUCTS } from '../data/marketProducts';
import { act, fireEvent, render } from '@testing-library/react-native';
import MarketScreen from './MarketScreen';
import type { ExploreNavigation, MarketRoute } from '../navigation/types';

jest.mock('@gorhom/bottom-sheet', () => ({
  BottomSheetModalProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: jest.requireActual('react-native').View,
}));
jest.mock('../components/CountryPickerSheet', () => {
  const { TouchableOpacity } = jest.requireActual('react-native');
  return function MockCountryPicker({
    visible,
    onSelect,
    onClose,
  }: {
    visible: boolean;
    onSelect: (code: string) => void;
    onClose: () => void;
  }) {
    return visible ? (
      <TouchableOpacity
        testID="country-picker-row-JP"
        onPress={() => {
          onSelect('JP');
          onClose();
        }}
      />
    ) : null;
  };
});

jest.mock('../hooks/useCollectionFilter', () => ({
  useCollectionFilter: function useMockCollectionFilter(
    products: unknown[],
    enabled: boolean,
    merchant: string | null,
  ) {
    const mockReact = jest.requireActual<typeof React>('react');
    const [selected, setSelected] = mockReact.useState<string | null>(mockSelectedCollection);
    mockCollectionScope(enabled, merchant);
    return {
      products: selected ? [] : products,
      collections: mockCollections,
      selected,
      select: (value: string | null) => {
        mockSelectCollection(value);
        setSelected(value);
      },
    };
  },
}));

jest.mock('../hooks/useMarketPreferences', () => ({
  useMarketPreferences: () => mockPreferencesHook(),
}));
const mockCollectionScope = jest.fn();
const mockSelectCollection = jest.fn();
let mockSelectedCollection: string | null = null;
let mockCollections: import('nostr-tools').Event[] = [];
let mockReady = true;
let mockCompleted = false;
let mockLoading = true;
let mockInitialPreferences = {
  mode: 'preferred',
  merchant: null as string | null,
  shipsTo: null as string | null,
  includeUnknownShipping: true,
  currency: null as string | null,
};
let mockShipsTo = new Map<string, import('../utils/marketShipsTo').ShipsTo>();
jest.mock('../hooks/useMarketShipsTo', () => ({
  useMarketShipsTo: () => ({ byProduct: mockShipsTo, deviceCountry: 'GB' }),
}));
const mockUpdate = jest.fn();
let mockLiveProducts: typeof import('../data/marketProducts').MARKET_PRODUCTS = [];
const mockPreferencesHook = function useMockPreferences() {
  const [preferences, setPreferences] = React.useState(mockInitialPreferences);
  return {
    ready: mockReady,
    preferences,
    update: (patch: object) => {
      mockUpdate(patch);
      setPreferences((previous) => ({ ...previous, ...patch }));
    },
  };
};
jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string) => key,
  useLocale: () => ({ t: (key: string) => key, locale: 'en', formatLocale: 'en-GB' }),
}));
jest.mock('../components/MarketProductCard', () => () => null);
jest.mock('../hooks/usePreferredMarketListings', () => ({
  usePreferredMarketListings: () => ({
    products: mockLiveProducts.length
      ? mockLiveProducts
      : jest.requireActual('../data/marketProducts').MARKET_PRODUCTS,
    loading: false,
    completed: true,
    incomplete: false,
    refresh: jest.fn(),
  }),
}));
jest.mock('../hooks/useMarketListings', () => ({
  useMarketListings: (enabled: boolean) => {
    mockLiveEnabled(enabled);
    return {
      products: mockLiveProducts,
      loading: enabled && mockLoading,
      completed: mockCompleted,
      incomplete: false,
      refresh: jest.fn(),
    };
  },
}));
jest.mock('lucide-react-native', () => ({
  ChevronLeft: () => null,
  Search: () => null,
  SlidersHorizontal: () => null,
  Store: () => null,
  X: () => null,
  Check: () => null,
  Lock: () => null,
}));
const mockLiveEnabled = jest.fn();
const navigation = { goBack: jest.fn(), navigate: jest.fn() } as unknown as ExploreNavigation;

beforeEach(() => {
  jest.useFakeTimers();
  mockLiveEnabled.mockClear();
  mockCollectionScope.mockClear();
  mockSelectCollection.mockClear();
  mockSelectedCollection = null;
  mockCollections = [];
  mockReady = true;
  mockCompleted = false;
  mockLoading = true;
  mockUpdate.mockClear();
  mockInitialPreferences = {
    mode: 'preferred',
    merchant: null,
    shipsTo: null,
    includeUnknownShipping: true,
    currency: null,
  };
  mockShipsTo = new Map();
  mockLiveProducts = [];
});
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
});

it('moves the single-choice seller scope into Filters and resets it from the search chip', () => {
  const screen = render(<MarketScreen navigation={navigation} />);
  expect(screen.queryByTestId('market-mode-selector')).toBeNull();
  expect(screen.queryByText('market.screen.showing')).toBeNull();
  expect(screen.queryByTestId('market-scope-chip-clear')).toBeNull();
  // The default preferred-sellers scope narrows the list, so the button is
  // already active with one filter.
  expect(screen.getByTestId('market-filter-active-count')).toHaveTextContent('1');
  expect(screen.getByTestId('market-filter-button').props.accessibilityState).toEqual({
    selected: true,
  });
  fireEvent.press(screen.getByTestId('market-filter-button'));
  // Nothing beyond the default to reset yet, so the panel's Clear is hidden.
  expect(screen.queryByTestId('market-filter-clear')).toBeNull();
  const preferred = screen.getByTestId('market-filter-sellers-preferred');
  const friends = screen.getByTestId('market-filter-sellers-friends');
  const fof = screen.getByTestId('market-filter-sellers-friends-of-friends');
  expect(preferred.props.accessibilityState).toEqual({ selected: true, disabled: false });
  expect(fof.props.accessibilityState).toEqual({ selected: false, disabled: true });
  fireEvent.press(fof);
  expect(mockLiveEnabled).toHaveBeenLastCalledWith(false);
  fireEvent.press(friends);
  expect(
    screen.getByTestId('market-filter-sellers-friends').props.accessibilityState.selected,
  ).toBe(true);
  expect(
    screen.getByTestId('market-filter-sellers-preferred').props.accessibilityState.selected,
  ).toBe(false);
  expect(mockLiveEnabled).toHaveBeenLastCalledWith(true);
  fireEvent.press(screen.getByTestId('market-filter-done'));
  act(() => jest.runOnlyPendingTimers());
  expect(screen.getByTestId('market-filter-active-count')).toHaveTextContent('1');
  expect(screen.getByTestId('market-live-status')).toHaveTextContent('market.live.loading');
  fireEvent.press(screen.getByTestId('market-scope-chip-clear'));
  expect(mockLiveEnabled).toHaveBeenLastCalledWith(false);
  expect(screen.getByTestId('market-filter-active-count')).toHaveTextContent('1');
  expect(screen.queryByTestId('market-scope-chip-clear')).toBeNull();
});

it('clears seller scope with the sheet filters and badges a non-empty search', () => {
  const screen = render(<MarketScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('market-filter-button'));
  fireEvent.press(screen.getByTestId('market-filter-sellers-friends'));
  fireEvent.press(screen.getByTestId('market-filter-clear'));
  expect(mockLiveEnabled).toHaveBeenLastCalledWith(false);
  expect(screen.queryByTestId('market-scope-chip-clear')).toBeNull();
  fireEvent.press(screen.getByTestId('market-filter-done'));
  act(() => jest.runOnlyPendingTimers());
  expect(screen.getByTestId('market-filter-active-count')).toHaveTextContent('1');
  fireEvent.changeText(screen.getByTestId('market-search-input'), 'piggy');
  expect(screen.getByTestId('market-filter-active-count')).toHaveTextContent('2');
  fireEvent.press(screen.getByTestId('market-search-clear'));
  expect(screen.getByTestId('market-filter-active-count')).toHaveTextContent('1');
});

it('gates listings and the first query until account filters finish restoring', () => {
  mockReady = false;
  const screen = render(<MarketScreen navigation={navigation} />);
  expect(mockLiveEnabled).toHaveBeenLastCalledWith(false);
  expect(screen.queryByTestId('market-search-input')).toBeNull();
  expect(screen.queryByText('market.screen.emptyNone')).toBeNull();
});
it('removes full loading copy once a cached or first-page result exists', () => {
  mockLiveProducts = MARKET_PRODUCTS.slice(0, 1);
  const screen = render(<MarketScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('market-filter-button'));
  fireEvent.press(screen.getByTestId('market-filter-sellers-friends'));
  expect(screen.getByTestId('market-live-status')).toHaveTextContent('market.live.updating');
  expect(screen.queryByText('market.live.loading')).toBeNull();
});

it('shows no-match copy instead of full loading when filters hide an existing snapshot', () => {
  mockLiveProducts = MARKET_PRODUCTS.slice(0, 1);
  const screen = render(<MarketScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('market-filter-button'));
  fireEvent.press(screen.getByTestId('market-filter-sellers-friends'));
  fireEvent.changeText(screen.getByTestId('market-search-input'), 'no such product');
  act(() => jest.advanceTimersByTime(300));
  expect(screen.queryByText('market.live.loading')).toBeNull();
  expect(screen.getByText('market.screen.emptyNoMatch')).toBeTruthy();
});

it('preserves all restored WoT filters before the first completed current-scope snapshot', () => {
  mockLoading = false; // Hydration render before the fetch effect sets loading.
  mockInitialPreferences = {
    mode: 'wotFriends',
    merchant: 'Saved merchant',
    shipsTo: 'DE',
    includeUnknownShipping: true,
    currency: 'EUR',
  };
  const screen = render(<MarketScreen navigation={navigation} />);
  expect(mockUpdate).not.toHaveBeenCalled();
  mockLoading = true;
  screen.rerender(<MarketScreen navigation={navigation} />);
  expect(mockUpdate).not.toHaveBeenCalled();
  mockLoading = false;
  mockCompleted = true;
  screen.rerender(<MarketScreen navigation={navigation} />);
  expect(mockUpdate).toHaveBeenCalledWith(
    // Ships-to is the shopper's destination, so it survives a catalogue
    // that has no listings for it; catalogue-derived axes reset.
    expect.objectContaining({ merchant: null, shipsTo: 'DE', currency: null }),
  );
});

it('filters by Ships to from shipping data, with unknown shipping behind the include toggle', () => {
  mockLiveProducts = [
    { ...MARKET_PRODUCTS[0], id: 'ships-gb' },
    { ...MARKET_PRODUCTS[0], id: 'ships-de' },
    { ...MARKET_PRODUCTS[0], id: 'worldwide' },
    { ...MARKET_PRODUCTS[0], id: 'unknown' },
  ];
  mockShipsTo = new Map([
    ['ships-gb', { kind: 'countries', countries: ['GB'] }],
    ['ships-de', { kind: 'countries', countries: ['DE'] }],
    ['worldwide', { kind: 'anywhere', reason: 'worldwide' }],
    ['unknown', { kind: 'unknown' }],
  ]);
  const screen = render(<MarketScreen navigation={navigation} />);
  const ids = () =>
    screen.UNSAFE_getByType(FlatList).props.data.map((product: { id: string }) => product.id);
  expect(ids()).toEqual(['ships-gb', 'ships-de', 'worldwide', 'unknown']);
  fireEvent.press(screen.getByTestId('market-filter-button'));
  // Phone's country (GB) leads the chips, after Anywhere.
  expect(screen.getByTestId('market-filter-shipsto-anywhere')).toBeTruthy();
  fireEvent.press(screen.getByTestId('market-filter-shipsto-GB'));
  expect(ids()).toEqual(['ships-gb', 'worldwide', 'unknown']);
  fireEvent(screen.getByTestId('market-filter-shipsto-include-unknown'), 'valueChange', false);
  expect(ids()).toEqual(['ships-gb', 'worldwide']);
  fireEvent.press(screen.getByTestId('market-filter-shipsto-anywhere'));
  expect(ids()).toEqual(['ships-gb', 'ships-de', 'worldwide', 'unknown']);
});

it('offers the phone country for worldwide sellers and keeps a picker selection as a chip', () => {
  mockLiveProducts = [{ ...MARKET_PRODUCTS[0], id: 'worldwide' }];
  mockShipsTo = new Map([['worldwide', { kind: 'anywhere', reason: 'worldwide' }]]);
  const screen = render(<MarketScreen navigation={navigation} />);
  fireEvent.press(screen.getByTestId('market-filter-button'));
  expect(screen.getByTestId('market-filter-shipsto-GB')).toBeTruthy();
  fireEvent.press(screen.getByTestId('market-filter-shipsto-more'));
  fireEvent.press(screen.getByTestId('country-picker-row-JP'));
  expect(screen.queryByTestId('country-picker-row-JP')).toBeNull();
  expect(screen.getByTestId('market-filter-shipsto-JP').props.accessibilityState.selected).toBe(
    true,
  );
  expect(mockUpdate).toHaveBeenCalledWith({ shipsTo: 'JP' });
  fireEvent(screen.getByTestId('market-filter-shipsto-include-unknown'), 'valueChange', false);
  expect(
    screen.UNSAFE_getByType(FlatList).props.data.map((product: { id: string }) => product.id),
  ).toEqual(['worldwide']);
  fireEvent.press(screen.getByTestId('market-filter-shipsto-JP'));
  expect(mockUpdate).toHaveBeenCalledWith({ shipsTo: null });
});

it('shows live preferred listings rather than the bundled catalogue', () => {
  mockLiveProducts = [
    { ...MARKET_PRODUCTS[0], id: 'live-preferred', title: 'Live preferred item' },
  ];
  const screen = render(<MarketScreen navigation={navigation} />);
  const list = screen.UNSAFE_getByType(FlatList);
  expect(list.props.data.map((product: { id: string }) => product.id)).toEqual(['live-preferred']);
});

it('updates the loaded label when switching between preferred sellers and friends', () => {
  mockLoading = false;
  const screen = render(<MarketScreen navigation={navigation} />);
  expect(screen.getByTestId('market-live-status')).toHaveTextContent('market.live.loadedPreferred');
  fireEvent.press(screen.getByTestId('market-filter-button'));
  fireEvent.press(screen.getByTestId('market-filter-sellers-friends'));
  expect(screen.getByTestId('market-live-status')).toHaveTextContent(/^market\.live\.loaded$/);
  fireEvent.press(screen.getByTestId('market-filter-done'));
  act(() => jest.runOnlyPendingTimers());
  fireEvent.press(screen.getByTestId('market-scope-chip-clear'));
  expect(screen.getByTestId('market-live-status')).toHaveTextContent('market.live.loadedPreferred');
});

it('hides collections without a merchant even when collection results exist', () => {
  mockCollections = [
    {
      pubkey: 'a'.repeat(64),
      tags: [
        ['d', 'art'],
        ['title', 'Art'],
      ],
    } as import('nostr-tools').Event,
  ];
  const screen = render(<MarketScreen navigation={navigation} />);
  expect(screen.queryByTestId('market-collection-filters')).toBeNull();
  expect(mockCollectionScope).toHaveBeenLastCalledWith(false, null);
});

it('enables merchant-scoped collections for a remembered single merchant', () => {
  const merchant = jest
    .requireActual('../utils/marketMerchants')
    .marketMerchants(MARKET_PRODUCTS)[0].id;
  mockInitialPreferences.merchant = merchant;
  mockCollections = [
    {
      pubkey: 'a'.repeat(64),
      tags: [
        ['d', 'art'],
        ['title', 'Art'],
      ],
    } as import('nostr-tools').Event,
  ];
  const screen = render(<MarketScreen navigation={navigation} />);
  expect(mockCollectionScope).toHaveBeenLastCalledWith(true, merchant);
  expect(screen.getByTestId('market-collection-filters')).toBeTruthy();
});

it.each(['preferred', 'wotFriends'] as const)(
  'See all resets conflicting filters on a reused %s grid, even for the same seller',
  (mode) => {
    const seller = 'a'.repeat(64);
    mockCompleted = true;
    mockLoading = false;
    mockInitialPreferences = {
      mode,
      merchant: seller,
      shipsTo: 'DE',
      includeUnknownShipping: false,
      currency: 'EUR',
    };
    mockSelectedCollection = `30405:${seller}:old-collection`;
    mockLiveProducts = [
      {
        ...MARKET_PRODUCTS[0],
        id: 'seller-item',
        listing: {
          event: { pubkey: seller, tags: [] },
          currency: 'SAT',
          vendor: { country: 'GB' },
        },
      } as unknown as (typeof MARKET_PRODUCTS)[number],
    ];
    const screen = render(<MarketScreen navigation={navigation} />);
    fireEvent.changeText(screen.getByTestId('market-search-input'), 'unrelated search');
    act(() => jest.advanceTimersByTime(300));
    expect(screen.UNSAFE_getByType(FlatList).props.data).toEqual([]);
    const route = {
      key: 'market',
      name: 'Market',
      params: { merchant: seller, mode },
    } as MarketRoute;
    screen.rerender(<MarketScreen navigation={navigation} route={route} />);
    act(() => jest.advanceTimersByTime(300));
    expect(mockUpdate).toHaveBeenCalledWith({
      merchant: seller,
      mode,
      shipsTo: null,
      includeUnknownShipping: true,
      currency: null,
    });
    expect(mockSelectCollection).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('market-search-input').props.value).toBe('');
    expect(screen.UNSAFE_getByType(FlatList).props.data.map((p: { id: string }) => p.id)).toEqual([
      'seller-item',
    ]);
    // Consumed params must not reset subsequent searches on preference renders.
    fireEvent.changeText(screen.getByTestId('market-search-input'), 'new search');
    screen.rerender(<MarketScreen navigation={navigation} route={route} />);
    expect(screen.getByTestId('market-search-input').props.value).toBe('new search');
  },
);
