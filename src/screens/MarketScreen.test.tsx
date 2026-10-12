import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import MarketScreen from './MarketScreen';
import type { ExploreNavigation } from '../navigation/types';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('../components/MarketProductCard', () => () => null);
jest.mock('../hooks/useMarketListings', () => ({
  useMarketListings: (enabled: boolean) => {
    mockLiveEnabled(enabled);
    return { products: [], loading: enabled, incomplete: false, refresh: jest.fn() };
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
  expect(screen.queryByTestId('market-filter-badge')).toBeNull();
  fireEvent.press(screen.getByTestId('market-filter-button'));
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
  expect(screen.getByTestId('market-filter-badge')).toBeTruthy();
  expect(screen.getByTestId('market-live-status')).toHaveTextContent('market.live.loading');
  fireEvent.press(screen.getByTestId('market-scope-chip-clear'));
  expect(mockLiveEnabled).toHaveBeenLastCalledWith(false);
  expect(screen.queryByTestId('market-filter-badge')).toBeNull();
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
  fireEvent.changeText(screen.getByTestId('market-search-input'), 'piggy');
  expect(screen.getByTestId('market-filter-badge')).toBeTruthy();
  fireEvent.press(screen.getByTestId('market-search-clear'));
  expect(screen.queryByTestId('market-filter-badge')).toBeNull();
});
