import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useChatLocalHistory } from './useChatLocalHistory';
import { loadChatClearBoundary } from '../services/chatLocalHistory';

const now = 1700000000;
const message = (id: string, createdAt: number) => ({ id, createdAt, text: id });
const old = message('old', now - 1);
const sameSecond = message('same-second', now);
const future = message('future', now + 86400);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
});
afterEach(() => jest.restoreAllMocks());

it('clears future-dated messages without hiding new arrivals, including the same second', async () => {
  const raw = [old, sameSecond, future];
  const hook = renderHook(
    ({ messages }: { messages: ReturnType<typeof message>[] }) =>
      useChatLocalHistory('owner', 'nip17:peer', messages),
    {
      initialProps: { messages: raw },
    },
  );
  await waitFor(() => expect(hook.result.current.messages).toEqual(raw));
  await act(() => hook.result.current.clear());
  expect(hook.result.current.messages).toEqual([]);
  expect(hook.result.current.clearBoundary).toBe(now);
  expect((await loadChatClearBoundary('owner', 'nip17:peer')).at).toBe(now);

  const arriving = [message('new-same-second', now), message('new', now + 1)];
  hook.rerender({ messages: [...raw, ...arriving] });
  expect(hook.result.current.messages).toEqual(arriving);
  hook.unmount();
  const reloaded = renderHook(() =>
    useChatLocalHistory('owner', 'nip17:peer', [...raw, ...arriving]),
  );
  await waitFor(() => expect(reloaded.result.current.messages).toEqual(arriving));
});

it('preserves messages arriving while the clear boundary is being saved', async () => {
  const raw = [old, future];
  const hook = renderHook(
    ({ messages }: { messages: ReturnType<typeof message>[] }) =>
      useChatLocalHistory('owner', 'nip17:peer', messages),
    {
      initialProps: { messages: raw },
    },
  );
  await waitFor(() => expect(hook.result.current.messages).toEqual(raw));
  let finishSave!: () => void;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
  );
  let clearing!: Promise<void>;
  act(() => {
    clearing = hook.result.current.clear();
  });
  const arriving = message('arriving', now);
  hook.rerender({ messages: [...raw, arriving] });
  await act(async () => {
    finishSave();
    await clearing;
  });
  expect(hook.result.current.messages).toEqual([arriving]);
});

it('retains cleared future IDs across repeated clears even when absent from the loaded window', async () => {
  const hook = renderHook(
    ({ messages }: { messages: ReturnType<typeof message>[] }) =>
      useChatLocalHistory('owner', 'nip17:peer', messages),
    {
      initialProps: { messages: [future] },
    },
  );
  await waitFor(() => expect(hook.result.current.messages).toEqual([future]));
  await act(() => hook.result.current.clear());
  jest.spyOn(Date, 'now').mockReturnValue((now + 10) * 1000);
  hook.rerender({ messages: [] });
  await act(() => hook.result.current.clear());
  hook.rerender({ messages: [future, message('new', now + 11)] });
  expect(hook.result.current.messages.map((m) => m.id)).toEqual(['new']);
});
