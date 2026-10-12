import { getConversationForEvent } from '../services/dmDb';
import { recordNotification } from '../services/notificationHistory';
import { toggleMutedSender } from '../services/mutedSenders';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNotificationHistory } from './useNotificationHistory';
import { perAccountKey } from '../services/perAccountStorage';
import { NOTIFICATION_HISTORY_KEY_BASE } from '../services/notificationHistory';

const PK = 'a'.repeat(64);
let mockPubkey = PK;
let mockOnStored: (owner: string) => void = () => {};
jest.mock('../contexts/NostrContext', () => ({ useNostr: () => ({ pubkey: mockPubkey }) }));
jest.mock('../services/dmDb', () => ({
  getConversationForEvent: jest.fn().mockResolvedValue(null),
  subscribeDmStorage: jest.fn((listener: (owner: string) => void) => {
    mockOnStored = listener;
    return jest.fn();
  }),
}));
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

it('hides muted senders and their unread badge while retaining history for unmute', async () => {
  const spy = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  await AsyncStorage.clear();
  mockPubkey = PK;
  const peer = 'c'.repeat(64);
  await recordNotification(PK, {
    id: 'muted-dm',
    kind: 'dm',
    title: 'Bot',
    body: '',
    data: { conversationPubkey: peer },
  });
  await recordNotification(PK, {
    id: 'payment',
    kind: 'payment',
    title: 'Payment',
    body: '',
    data: {},
  });
  const { result, unmount } = renderHook(() => useNotificationHistory());
  await waitFor(() => expect(result.current.unreadCount).toBe(2));
  await act(async () => {
    await toggleMutedSender(PK, peer);
  });
  await waitFor(() => expect(result.current.entries.map((e) => e.id)).toEqual(['payment']));
  expect(result.current.unreadCount).toBe(1);
  await act(async () => {
    await toggleMutedSender(PK, peer);
  });
  await waitFor(() => expect(result.current.unreadCount).toBe(2));
  unmount();
  spy.mockRestore();
});

it('filters a contentless wrap after the DM store identifies its muted sender', async () => {
  const spy = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  await AsyncStorage.clear();
  mockPubkey = PK;
  const peer = 'c'.repeat(64);
  await toggleMutedSender(PK, peer);
  (getConversationForEvent as jest.Mock).mockResolvedValue({
    conversation: peer,
    wireKind: 14,
    fromMe: false,
  });
  await recordNotification(PK, {
    id: 'wrap-row',
    kind: 'dm',
    title: 'Encrypted message',
    body: '',
    data: { wrapId: 'wrap-id' },
  });
  const { result, unmount } = renderHook(() => useNotificationHistory());
  await waitFor(() => expect(getConversationForEvent).toHaveBeenCalledWith(PK, 'wrap-id'));
  await act(async () => {
    await toggleMutedSender(PK, peer);
  });
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  expect(result.current.entries[0].data).toMatchObject({
    conversationPubkey: peer,
    conversationProtocol: 'nip17',
  });
  await act(async () => {
    await toggleMutedSender(PK, peer);
  });
  await waitFor(() => expect(result.current.entries).toEqual([]));
  expect(result.current.unreadCount).toBe(0);
  unmount();
  spy.mockRestore();
});

it('re-resolves late-decrypted wraps after coalesced account-scoped storage updates', async () => {
  const spy = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  await AsyncStorage.clear();
  mockPubkey = PK;
  const peer = 'd'.repeat(64);
  await toggleMutedSender(PK, peer);
  (getConversationForEvent as jest.Mock).mockResolvedValue(null);
  await recordNotification(PK, {
    id: 'late-wrap',
    kind: 'dm',
    title: 'Encrypted message',
    body: '',
    data: { wrapId: 'late-wrap-id' },
  });
  const { result, unmount } = renderHook(() => useNotificationHistory());
  await waitFor(() => expect(result.current.unreadCount).toBe(1));
  const onStored = mockOnStored;
  (getConversationForEvent as jest.Mock).mockClear().mockResolvedValue({
    conversation: peer,
    wireKind: 14,
    fromMe: false,
  });
  jest.useFakeTimers();
  act(() => {
    onStored('another-account');
    jest.advanceTimersByTime(100);
  });
  expect(getConversationForEvent).not.toHaveBeenCalled();
  act(() => {
    for (let i = 0; i < 20; i++) onStored(PK);
    jest.advanceTimersByTime(100);
  });
  jest.useRealTimers();
  await waitFor(() => expect(result.current.unreadCount).toBe(0));
  expect(result.current.entries).toEqual([]);
  expect(getConversationForEvent).toHaveBeenCalledTimes(1);
  await act(async () => {
    await toggleMutedSender(PK, peer);
  });
  await waitFor(() => expect(result.current.unreadCount).toBe(1));
  expect(result.current.entries[0].data.conversationPubkey).toBe(peer);
  jest.useFakeTimers();
  act(() => onStored(PK));
  unmount();
  act(() => jest.advanceTimersByTime(100));
  jest.useRealTimers();
  expect(getConversationForEvent).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
