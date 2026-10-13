import { act, renderHook } from '@testing-library/react-native';
import { useSettingsPicker } from './useSettingsPicker';

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
let mockParams: { settingsSelection?: string } | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    setParams: mockSetParams,
    getState: () => ({ key: 'drawer' }),
    getParent: () => ({ navigate: mockNavigate }),
  }),
  useRoute: () => ({ key: 'messages', params: mockParams }),
  useFocusEffect: (callback: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(callback, [callback]);
  },
}));

beforeEach(() => {
  mockParams = undefined;
  jest.clearAllMocks();
});
const picker = {
  title: 'Who you see',
  selectedValue: 'all',
  options: [{ value: 'friends', label: 'Friends' }],
  testID: 'trust-picker',
};

it('returns a choice once to the originating account and clears the route result', () => {
  const select = jest.fn();
  const { result, rerender } = renderHook(
    ({ owner }: { owner: string }) => useSettingsPicker(owner, select),
    {
      initialProps: { owner: 'account-a' },
    },
  );
  act(() => result.current(picker));
  expect(mockNavigate).toHaveBeenCalledWith('SettingsPicker', {
    ...picker,
    returnTo: { routeKey: 'messages', navigatorKey: 'drawer', param: 'settingsSelection' },
  });
  mockParams = { settingsSelection: 'friends' };
  rerender({ owner: 'account-a' });
  rerender({ owner: 'account-a' });
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith('friends');
  expect(mockSetParams).toHaveBeenCalledWith({ settingsSelection: undefined });
});

it('discards a choice after switching accounts, even if the original account returns', () => {
  const select = jest.fn();
  const { result, rerender } = renderHook(
    ({ owner }: { owner: string }) => useSettingsPicker(owner, select),
    {
      initialProps: { owner: 'account-a' },
    },
  );
  act(() => result.current(picker));
  rerender({ owner: 'account-b' });
  mockParams = { settingsSelection: 'friends' };
  rerender({ owner: 'account-a' });
  expect(select).not.toHaveBeenCalled();
});

it('opening and cancelling a picker never saves a setting', () => {
  const select = jest.fn();
  const { result, rerender } = renderHook(() => useSettingsPicker('account-a', select));
  act(() => result.current(picker));
  rerender({});
  expect(select).not.toHaveBeenCalled();
});
