import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useNotificationMessageWindow } from './useNotificationMessageWindow';
import { getConversationMessageWindow } from '../services/dmDb';
jest.mock('../services/dmDb', () => ({ getConversationMessageWindow: jest.fn() }));
const lookup = jest.mocked(getConversationMessageWindow);
const newest = [
  { id: 'new', text: 'new', fromMe: false, createdAt: 100, protocol: 'marmot' as const },
];
const older = {
  owner: 'big',
  conversation: 'peer',
  eventId: 'old',
  content: 'old',
  fromMe: false,
  sender: 'peer',
  createdAt: 1,
  wireKind: 9,
  protocol: 'marmot' as const,
};
beforeEach(() => lookup.mockReset());
it('loads an older target and retains it after navigation consumes the jump param', async () => {
  lookup.mockResolvedValue([older]);
  const { result, rerender } = renderHook(
    ({ messageId }: { messageId?: string }) =>
      useNotificationMessageWindow('big', 'peer', 'marmot', messageId, newest),
    { initialProps: { messageId: 'old' } },
  );
  await waitFor(() => expect(result.current.map((m) => m.id)).toEqual(['old', 'new']));
  rerender({ messageId: undefined });
  expect(result.current.map((m) => m.id)).toEqual(['old', 'new']);
});
it('falls back to newest for a missing target or storage failure', async () => {
  lookup.mockRejectedValue(new Error('unavailable'));
  const { result } = renderHook(() =>
    useNotificationMessageWindow('big', 'peer', 'marmot', 'gone', newest),
  );
  await act(async () => {});
  expect(result.current).toEqual(newest);
});
it('does not display a late history result after an account switch', async () => {
  let resolve!: (rows: (typeof older)[]) => void;
  lookup.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { result, rerender } = renderHook(
    ({ owner, messageId }: { owner: string; messageId?: string }) =>
      useNotificationMessageWindow(owner, 'peer', 'marmot', messageId, newest),
    { initialProps: { owner: 'big', messageId: 'old' } },
  );
  rerender({ owner: 'little', messageId: undefined });
  await act(async () => resolve([older]));
  expect(result.current).toEqual(newest);
});
