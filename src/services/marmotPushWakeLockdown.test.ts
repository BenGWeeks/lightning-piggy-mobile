import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { TEST_ACCOUNT_PUBKEYS } from '../config/testRelayLockdown';
import { loadIdentities } from './identitiesStore';
import {
  getCurrentUserPubkey,
  getCurrentUserReadRelays,
  onCurrentUserPubkeyChange,
  setCurrentUserPubkey,
  setCurrentUserReadRelays,
} from './nostrActiveAccount';
import { fireMessageNotification } from './notificationService';
import { MARMOT_PUSH_WAKE_TASK } from './marmotPushWake';

jest.mock('react-native', () => ({ AppState: { currentState: 'background' } }));
jest.mock('expo-task-manager', () => ({ isTaskDefined: () => false, defineTask: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn() }));
jest.mock('./identitiesStore', () => ({ loadIdentities: jest.fn() }));
jest.mock('./notificationHistory', () => ({}));
jest.mock('./notificationService', () => ({
  dismissNotificationsFor: jest.fn().mockResolvedValue(0),
  fireMessageNotification: jest.fn().mockResolvedValue('id'),
  lastMarmotNotificationAt: () => 0,
}));
jest.mock('./watcherPushReceive', () => ({ isWatcherTaskPayload: () => false }));

const callback = jest
  .mocked(TaskManager.defineTask)
  .mock.calls.find(([name]) => name === MARMOT_PUSH_WAKE_TASK)![1];
const wake = () => {
  return callback({ data: {}, error: null, executionInfo: {} } as Parameters<typeof callback>[0]);
};

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
  setCurrentUserPubkey(null);
  setCurrentUserReadRelays([]);
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  jest.mocked(loadIdentities).mockResolvedValue({ activePubkey: null, identities: [] });
});
afterEach(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = true;
  setCurrentUserPubkey(null);
  setCurrentUserReadRelays([]);
});

it.each(
  ['nsec', 'amber', 'nip46'].flatMap((signer) => [
    { signer, foreground: null },
    { signer, foreground: 'a'.repeat(64) },
  ]),
)(
  'delivers release pushes without resolving or changing $signer routing (foreground=$foreground)',
  async ({ signer, foreground }) => {
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    // A test identity would close public subscriptions if DEV hydration leaked.
    const saved = [...TEST_ACCOUNT_PUBKEYS][0];
    jest
      .mocked(SecureStore.getItemAsync)
      .mockImplementation(async (key) => (key === 'nostr_signer_type' ? signer : saved));
    jest.mocked(loadIdentities).mockResolvedValue({ activePubkey: saved, identities: [] });
    setCurrentUserPubkey(foreground);
    setCurrentUserReadRelays(['wss://foreground.example']);
    const changed = jest.fn();
    const unsubscribe = onCurrentUserPubkeyChange(changed);
    try {
      await wake();
      expect(fireMessageNotification).toHaveBeenCalledTimes(1);
      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
      expect(loadIdentities).not.toHaveBeenCalled();
      expect(getCurrentUserPubkey()).toBe(foreground);
      expect(getCurrentUserReadRelays()).toEqual(['wss://foreground.example']);
      expect(changed).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  },
);

it.each(['missing', 'locked', 'corrupt'])(
  'delivers DEV pushes when the identity is %s',
  async (state) => {
    if (state === 'locked')
      jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('locked'));
    if (state === 'corrupt') {
      jest
        .mocked(SecureStore.getItemAsync)
        .mockImplementation(async (key) => (key === 'nostr_signer_type' ? 'nip46' : '{bad'));
    }
    await wake();
    expect(fireMessageNotification).toHaveBeenCalledTimes(1);
    expect(getCurrentUserPubkey()).toBeNull();
  },
);

it('suppresses DEV pushes only for a known locked test account', async () => {
  setCurrentUserPubkey([...TEST_ACCOUNT_PUBKEYS][0]);
  await wake();
  expect(fireMessageNotification).not.toHaveBeenCalled();
});
