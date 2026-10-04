import {
  startBackgroundDmWatch,
  stopBackgroundDmWatch,
  __resetForTests,
} from './backgroundDmService';

const mockStartNative = jest.fn();
const mockStartPayments = jest.fn();
const mockSubscribe = jest.fn();
const mockShowForeground = jest.fn();

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn() },
}));
jest.mock('../../modules/background-dm-service', () => ({
  isBackgroundDmServiceAvailable: () => true,
  startForegroundService: () => mockStartNative(),
  stopForegroundService: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./backgroundPaymentService', () => ({
  canWatchBackgroundPayments: jest.fn().mockResolvedValue(true),
  isBackgroundPaymentWatchRunning: () => false,
  startBackgroundPaymentWatch: (...args: unknown[]) => mockStartPayments(...args),
  stopBackgroundPaymentWatch: jest.fn(),
}));
jest.mock('./notificationService', () => ({
  hasNotificationPermission: jest.fn().mockResolvedValue(true),
  showForegroundServiceNotification: (...args: unknown[]) => mockShowForeground(...args),
  dismissForegroundServiceNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./backgroundDmPreference', () => ({ loadBackgroundDmEnabled: jest.fn() }));
jest.mock('./identitiesStore', () => ({ loadIdentities: jest.fn() }));
jest.mock('./nostrRelayStorage', () => ({}));
jest.mock('./nostrService', () => ({}));
jest.mock('./dmLiveSubscription', () => ({
  subscribeInboxDmsForViewer: (...args: unknown[]) => mockSubscribe(...args),
}));
jest.mock('./zapSenderProfileStorage', () => ({}));
jest.mock('../utils/nip17Unwrap', () => ({}));

beforeEach(() => {
  jest.clearAllMocks();
  __resetForTests();
  mockStartNative.mockResolvedValue(undefined);
});

it('repairs payment polling when a running native host does not dispatch a new headless task', async () => {
  // No JS watch survived the earlier headless arm. Android's existing service
  // makes startService a no-op; re-arm also has no JS watch to swap.
  await startBackgroundDmWatch();
  expect(mockStartNative).toHaveBeenCalledTimes(1);
  expect(mockStartPayments).toHaveBeenCalledTimes(1);
  expect(mockSubscribe).not.toHaveBeenCalled();
  expect(mockShowForeground).not.toHaveBeenCalled();
});

it('does not resurrect payment polling when a native start is superseded by a stop', async () => {
  let release!: () => void;
  mockStartNative.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const start = startBackgroundDmWatch();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await stopBackgroundDmWatch();
  release();
  await start;
  expect(mockStartPayments).not.toHaveBeenCalled();
});
