import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNotificationHistory } from './useNotificationHistory';
import { perAccountKey } from '../services/perAccountStorage';
import { NOTIFICATION_HISTORY_KEY_BASE } from '../services/notificationHistory';

const PK = 'a'.repeat(64);
let mockPubkey = PK;
jest.mock('../contexts/NostrContext', () => ({ useNostr: () => ({ pubkey: mockPubkey }) }));
jest.mock('../services/notificationService', () => ({ dismissNotificationsFor: jest.fn() }));

it('re-reads history written by another JS context when the app resumes', async () => {
  let onChange: ((s: AppStateStatus) => void) | undefined;
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    onChange = handler as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
  const { result } = renderHook(() => useNotificationHistory());
  await waitFor(() => expect(result.current.entries).toEqual([]));

  // A background worker (separate context) writes straight to storage.
  const entry = {
    id: '1',
    kind: 'dm',
    title: 'Little Piggy',
    data: {},
    createdAt: Date.now(),
    read: false,
  };
  await AsyncStorage.setItem(
    perAccountKey(NOTIFICATION_HISTORY_KEY_BASE, PK),
    JSON.stringify([entry]),
  );

  jest.useFakeTimers();
  act(() => onChange?.('active'));
  act(() => jest.advanceTimersByTime(3000));
  jest.useRealTimers();
  await waitFor(() => expect(result.current.unreadCount).toBe(1));
  spy.mockRestore();
});

it('clears notification previews and the unread badge on the first switch render', async () => {
  const spy = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  mockPubkey = PK;
  await AsyncStorage.setItem(
    perAccountKey(NOTIFICATION_HISTORY_KEY_BASE, PK),
    JSON.stringify([
      {
        id: 'a-dm',
        kind: 'dm',
        title: 'Private account A',
        data: {},
        createdAt: Date.now(),
        read: false,
      },
    ]),
  );
  const renders: number[] = [];
  const { result, rerender, unmount } = renderHook(() => {
    const history = useNotificationHistory();
    renders.push(history.unreadCount);
    return history;
  });
  await waitFor(() => expect(result.current.unreadCount).toBe(1));
  const switchIndex = renders.length;
  mockPubkey = 'b'.repeat(64);
  rerender({});
  expect(renders[switchIndex]).toBe(0);
  expect(result.current.entries).toEqual([]);
  unmount();
  spy.mockRestore();
  mockPubkey = PK;
});
