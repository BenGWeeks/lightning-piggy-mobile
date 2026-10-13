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

it('refreshes retained history as live rows update and loads a new target', async () => {
  lookup.mockResolvedValue([older]);
  const { result, rerender } = renderHook(
    ({ messageId, messages }: { messageId?: string; messages: typeof newest }) =>
      useNotificationMessageWindow('big', 'peer', 'marmot', messageId, messages),
    { initialProps: { messageId: 'old' as string | undefined, messages: newest } },
  );
  await waitFor(() => expect(result.current.map((m) => m.id)).toEqual(['old', 'new']));
  const updated = [...newest, { ...newest[0], id: 'newer', createdAt: 101 }];
  rerender({ messageId: 'old', messages: updated });
  rerender({ messageId: undefined, messages: [...updated] });
  await act(async () => {});
  expect(lookup).toHaveBeenCalledTimes(3);
  expect(result.current.map((m) => m.id)).toEqual(['old', 'new', 'newer']);
  lookup.mockResolvedValue([{ ...older, eventId: 'another' }]);
  rerender({ messageId: 'another', messages: updated });
  await waitFor(() => expect(result.current.map((m) => m.id)).toEqual(['another', 'new', 'newer']));
  expect(lookup).toHaveBeenCalledTimes(4);
});

it('retries a missing history target when live messages update', async () => {
  lookup.mockResolvedValue([]);
  const { result, rerender } = renderHook(
    ({ messages }: { messages: typeof newest }) =>
      useNotificationMessageWindow('big', 'peer', 'marmot', 'old', messages),
    { initialProps: { messages: newest } },
  );
  await act(async () => {});
  expect(lookup).toHaveBeenCalledTimes(1);
  lookup.mockResolvedValue([older]);
  rerender({ messages: [...newest] });
  await waitFor(() => expect(result.current.map((m) => m.id)).toEqual(['old', 'new']));
  expect(lookup).toHaveBeenCalledTimes(2);
});

it('drops a deleted history row after the jump param is consumed', async () => {
  const neighbor = { ...older, eventId: 'neighbor', createdAt: 2 };
  lookup.mockResolvedValue([older, neighbor]);
  const { result, rerender } = renderHook(
    ({ messageId, messages }: { messageId?: string; messages: typeof newest }) =>
      useNotificationMessageWindow('big', 'peer', 'marmot', messageId, messages),
    { initialProps: { messageId: 'old' as string | undefined, messages: newest } },
  );
  await waitFor(() => expect(result.current.map((m) => m.id)).toEqual(['old', 'neighbor', 'new']));
  rerender({ messageId: undefined, messages: newest });
  await act(async () => {});
  // A delete-for-everyone commits to the store and refreshes the newest slice.
  // Neither history row is in that slice, so absence there alone is not deletion.
  lookup.mockResolvedValue([older]);
  rerender({ messageId: undefined, messages: [...newest] });
  await waitFor(() => expect(result.current.map((m) => m.id)).toEqual(['old', 'new']));
});

it('drops the retained window when its target is deleted after the jump param is consumed', async () => {
  lookup.mockResolvedValue([older]);
  const { result, rerender } = renderHook(
    ({ messageId, messages }: { messageId?: string; messages: typeof newest }) =>
      useNotificationMessageWindow('big', 'peer', 'marmot', messageId, messages),
    { initialProps: { messageId: 'old' as string | undefined, messages: newest } },
  );
  await waitFor(() => expect(result.current.map((m) => m.id)).toEqual(['old', 'new']));
  rerender({ messageId: undefined, messages: newest });
  await act(async () => {});
  lookup.mockResolvedValue([]);
  rerender({ messageId: undefined, messages: [...newest] });
  await waitFor(() => expect(result.current).toEqual(newest));
});

it('takes the latest edit outside the newest slice after the jump param is consumed', async () => {
  lookup.mockResolvedValue([older]);
  const { result, rerender } = renderHook(
    ({ messageId, messages }: { messageId?: string; messages: typeof newest }) =>
      useNotificationMessageWindow('big', 'peer', 'marmot', messageId, messages),
    { initialProps: { messageId: 'old' as string | undefined, messages: newest } },
  );
  await waitFor(() => expect(result.current[0].text).toBe('old'));
  rerender({ messageId: undefined, messages: newest });
  await act(async () => {});
  lookup.mockResolvedValue([{ ...older, content: 'edited', editedAt: 102 }]);
  rerender({ messageId: undefined, messages: [...newest] });
  await waitFor(() =>
    expect(result.current[0]).toMatchObject({ id: 'old', text: 'edited', editedAt: 102 }),
  );
  expect(result.current.map((m) => m.id)).toEqual(['old', 'new']);
});
