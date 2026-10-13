import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import DisplayScreen from './DisplayScreen';

const mockSetCurrency = jest.fn();
const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate };
const mockRowRender = jest.fn();
let mockCurrency = 'USD';
const mockTranslate = (key: string, params?: { code: string; name: string }) =>
  params ? `${params.code} ${params.name}` : key;

jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('../../contexts/WalletContext', () => ({
  useWallet: () => ({ currency: mockCurrency, setCurrency: mockSetCurrency }),
}));
jest.mock('../../contexts/ThemeContext', () => ({
  useThemeColors: () => jest.requireActual('../../styles/palettes').darkPalette,
}));
jest.mock('../../contexts/LocaleContext', () => ({ useTranslation: () => mockTranslate }));
jest.mock('../../services/fiatService', () => ({
  CURRENCY_LIST: [
    { code: 'USD', name: 'US Dollar' },
    { code: 'CAD', name: 'Canadian Dollar' },
    { code: 'KRW', name: 'South Korean Won' },
    { code: 'DKK', name: 'Danish Krone' },
  ],
}));
jest.mock('./AccountScreenLayout', () => {
  const Layout = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return Layout;
});
// Instrument the memo boundary with the same shallow-prop comparison as the shared row.
jest.mock('../../components/SettingsPickerOptionRow', () => {
  const React = jest.requireActual('react');
  const { Text, TouchableOpacity } = jest.requireActual('react-native');
  return React.memo(function CurrencyRow(props: {
    option: { value: string; label: string };
    onSelect: (value: string) => void;
    testID: string;
  }) {
    mockRowRender(props);
    return (
      <TouchableOpacity testID={props.testID} onPress={() => props.onSelect(props.option.value)}>
        <Text>{props.option.label}</Text>
      </TouchableOpacity>
    );
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockCurrency = 'USD';
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('keeps mounted currency rows memoized while typing and selects a filtered currency', async () => {
  const ui = render(<DisplayScreen />);
  await act(async () => {});
  expect(mockRowRender).toHaveBeenCalledTimes(4);
  mockRowRender.mockClear();
  fireEvent.changeText(ui.getByTestId('currency-search'), 'd');
  await act(async () => {});
  expect(ui.getByTestId('currency-USD')).toBeTruthy();
  expect(ui.getByTestId('currency-CAD')).toBeTruthy();
  expect(ui.queryByTestId('currency-KRW')).toBeNull();
  expect(mockRowRender).not.toHaveBeenCalled();
  fireEvent.changeText(ui.getByTestId('currency-search'), 'dol');
  await act(async () => {});
  expect(ui.queryByTestId('currency-DKK')).toBeNull();
  expect(mockRowRender).not.toHaveBeenCalled();
  fireEvent.press(ui.getByTestId('currency-CAD'));
  expect(mockSetCurrency).toHaveBeenCalledWith('CAD');
  expect(mockNavigate).toHaveBeenCalledWith('AccountDisplayLanguage');
  expect(ui.getByTestId('currency-search').props.value).toBe('');
});

it('updates selection props when the active currency changes', async () => {
  const ui = render(<DisplayScreen />);
  await act(async () => {});
  mockRowRender.mockClear();
  mockCurrency = 'CAD';
  ui.rerender(<DisplayScreen />);
  await act(async () => {});
  expect(mockRowRender).toHaveBeenCalledTimes(2);
  expect(mockRowRender).toHaveBeenCalledWith(
    expect.objectContaining({
      option: expect.objectContaining({ value: 'CAD' }),
      selected: true,
    }),
  );
  expect(mockRowRender).toHaveBeenCalledWith(
    expect.objectContaining({
      option: expect.objectContaining({ value: 'USD' }),
      selected: false,
    }),
  );
});

it('still searches case-insensitively by both code and currency name', async () => {
  const ui = render(<DisplayScreen />);
  fireEvent.changeText(ui.getByTestId('currency-search'), ' Kr ');
  await act(async () => {});
  expect(ui.getByTestId('currency-KRW')).toBeTruthy();
  expect(ui.getByTestId('currency-DKK')).toBeTruthy();
  expect(ui.queryByTestId('currency-USD')).toBeNull();
});
