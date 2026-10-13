// Canonical tray targets must preserve message and protocol identifiers.
import {
  fireMessageNotification,
  notificationMatchesTarget,
  threadCollapseKey,
  __resetForTests,
} from './notificationService';
import AsyncStorage from '@react-native-async-storage/async-storage';
const mockScheduleNotificationAsync = jest.fn().mockResolvedValue('notif-id');
const mockGetPresented = jest.fn().mockResolvedValue([]);
const mockDismiss = jest.fn().mockResolvedValue(undefined);
const mockGetScheduled = jest.fn().mockResolvedValue([]);
const mockCancel = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  getPresentedNotificationsAsync: () => mockGetPresented(),
  dismissNotificationAsync: (id: string) => mockDismiss(id),
  getAllScheduledNotificationsAsync: () => mockGetScheduled(),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { SECRET: -1, PRIVATE: 0, PUBLIC: 1 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

const lastScheduledContent = () => mockScheduleNotificationAsync.mock.calls.at(-1)?.[0]?.content;

beforeEach(async () => {
  mockScheduleNotificationAsync.mockClear();
  await AsyncStorage.clear();
  __resetForTests();
});

it('stores both Marmot DM identifiers and its message in the canonical tray target', async () => {
  await fireMessageNotification({
    kind: 'dm',
    threadId: 'peer:marmot',
    title: 'Alice',
    body: 'hello',
    data: {
      conversationPubkey: 'peer',
      conversationProtocol: 'marmot',
      marmotGroupId: 'marmot:dm',
      messageId: 'old',
    },
  });
  expect(lastScheduledContent()?.data).toMatchObject({
    threadKind: 'dm',
    protocol: 'marmot',
    conversationPubkey: 'peer',
    groupId: 'marmot:dm',
    messageId: 'old',
  });
});

it('uses the canonical protocol for alert grouping and focused-thread dismissal', () => {
  const data = {
    conversationPubkey: 'peer',
    protocol: 'marmot' as const,
    conversationProtocol: 'nip17' as const,
  };
  expect(threadCollapseKey('dm', data)).toBe('dm:marmot:peer');
  expect(
    notificationMatchesTarget(data, { conversationPubkey: 'peer', conversationProtocol: 'marmot' }),
  ).toBe(true);
  expect(
    notificationMatchesTarget(data, { conversationPubkey: 'peer', conversationProtocol: 'nip17' }),
  ).toBe(false);
});
