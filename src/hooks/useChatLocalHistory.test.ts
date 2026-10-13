import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useChatLocalHistory } from './useChatLocalHistory';
import {
  appendGroupMessage,
  rekeyGroupMessage,
  loadGroupMessages,
  type GroupMessage,
} from '../services/groupMessagesStorageService';
import type { ConversationMessage } from '../contexts/nostrContextTypes';
import { mergeConversationMessages } from '../contexts/nostrDmCache';
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

jest.mock('../services/groupMessagesMigration', () => ({
  ensureGroupMessagesMigrated: async () => {},
}));

it.each(['nip17', 'marmot'] as const)(
  'keeps a cleared %s send hidden after its relay echo and restart',
  async (protocol) => {
    const pending = {
      ...message('local-rumor', now),
      text: 'same text',
      fromMe: true,
      rumorId: 'rumor',
      wireKind: 14,
      protocol,
    };
    const hook = renderHook(
      ({ messages }: { messages: ConversationMessage[] }) =>
        useChatLocalHistory('owner', `${protocol}:peer`, messages),
      { initialProps: { messages: [pending] } },
    );
    await waitFor(() => expect(hook.result.current.messages).toEqual([pending]));
    await act(() => hook.result.current.clear());
    const echo = { ...pending, id: 'real-wrap' };
    const arriving = { ...pending, id: 'local-new', rumorId: 'new-rumor' };
    const merged = mergeConversationMessages([pending], [echo, arriving], 100);
    hook.rerender({ messages: merged });
    expect(hook.result.current.messages).toEqual([arriving]);
    hook.unmount();
    const reloaded = renderHook(() => useChatLocalHistory('owner', `${protocol}:peer`, merged));
    await waitFor(() => expect(reloaded.result.current.messages).toEqual([arriving]));
  },
);

it.each(['nip17 echo', 'marmot rekey', 'marmot existing real row'])(
  'keeps a cleared group send hidden through %s and storage reload',
  async (path) => {
    const pending: GroupMessage = {
      ...message('local_pending', now),
      text: 'same text',
      senderPubkey: 'a'.repeat(64),
    };
    await appendGroupMessage('a'.repeat(64), 'group', pending);
    const hook = renderHook(
      ({ messages }: { messages: GroupMessage[] }) =>
        useChatLocalHistory('a'.repeat(64), 'group', messages),
      { initialProps: { messages: [pending] } },
    );
    await waitFor(() => expect(hook.result.current.messages).toEqual([pending]));
    await act(() => hook.result.current.clear());
    const echo = { ...pending, id: 'real-rumor' };
    if (path === 'nip17 echo') await appendGroupMessage('a'.repeat(64), 'group', echo);
    else {
      if (path === 'marmot existing real row')
        await appendGroupMessage('a'.repeat(64), 'group', { ...echo, text: 'edited text' });
      await rekeyGroupMessage('a'.repeat(64), 'group', pending.id, echo.id);
    }
    // Replays, including repaired text, must retain the optimistic alias.
    await appendGroupMessage('a'.repeat(64), 'group', { ...echo, createdAt: now + 1 });
    const arriving = { ...pending, id: 'local_new' };
    await appendGroupMessage('a'.repeat(64), 'group', arriving);
    const stored = await loadGroupMessages('a'.repeat(64), 'group');
    hook.rerender({ messages: stored });
    expect(hook.result.current.messages).toEqual([arriving]);
    hook.unmount();
    const reloaded = renderHook(() => useChatLocalHistory('a'.repeat(64), 'group', stored));
    await waitFor(() => expect(reloaded.result.current.messages).toEqual([arriving]));
  },
);
