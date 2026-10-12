import { act, renderHook } from '@testing-library/react-native';
import { Alert } from '../components/BrandedAlert';
import { useMuteNotificationAction } from './useMuteNotificationAction';
import mockEn from '../i18n/locales/en.json';

const mockToggle = jest.fn().mockResolvedValue(undefined);
let mockMuted = new Set<string>();
let mockReady = true;
jest.mock('./useMutedSenders', () => ({
  useMutedSenders: () => ({ mutedSenders: mockMuted, ready: mockReady, toggle: mockToggle }),
}));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string) => {
    if (key === 'addWalletWizard.cancel') return 'Cancel';
    return (mockEn.notificationMute as Record<string, string>)[key.split('.')[1]];
  },
}));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
jest.mock('../components/BrandedToast', () => ({ __esModule: true, default: { show: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockMuted = new Set();
  mockReady = true;
});

it.each([
  [false, 'Mute notifications from this account', 'Mute'],
  [true, 'Unmute notifications from this account', 'Unmute'],
])('keeps the descriptive title and uses a short action (muted=%s)', (muted, title, label) => {
  if (muted) mockMuted.add('peer');
  const { result } = renderHook(useMuteNotificationAction);
  act(() => result.current('PEER', 'mute-peer'));
  expect(Alert.alert).toHaveBeenCalledWith(title, undefined, [
    expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
    expect.objectContaining({ text: label, testID: 'mute-peer' }),
  ]);
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  buttons[1].onPress();
  expect(mockToggle).toHaveBeenCalledWith('PEER');
});

it('does not open a confirmation before mutes are loaded', () => {
  mockReady = false;
  const { result } = renderHook(useMuteNotificationAction);
  act(() => result.current('peer', 'mute-peer'));
  expect(Alert.alert).not.toHaveBeenCalled();
});
