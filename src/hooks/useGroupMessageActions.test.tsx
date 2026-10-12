import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useGroupMessageActions } from './useGroupMessageActions';
import { messageEditDelete } from '../utils/messageEditDelete';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
const mockT = (key: string) => key;
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => mockT }));
jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
const mockPublish = jest.fn(async () => 'f'.repeat(64));
const mockDelete = jest.fn(async () => true);
const mockFetch = jest.fn<Promise<unknown[]>, []>(async () => []);
const mockDeletions = jest.fn(async () => []);
let mockEmit: (e: unknown) => void;
jest.mock('../services/marmotReactions', () => ({
  marmotReactionSource: () => ({
    publishReaction: mockPublish,
    deleteReaction: mockDelete,
    fetchReactionsForMessages: mockFetch,
    fetchReactionDeletions: mockDeletions,
    subscribe: (callback: typeof mockEmit) => {
      mockEmit = callback;
      return () => {};
    },
  }),
}));
const me = 'a'.repeat(64);
const bob = 'b'.repeat(64);
const carol = 'c'.repeat(64);
const target = 'd'.repeat(64);
const message = { id: target, senderPubkey: bob, text: 'hello', createdAt: 1 };
const reaction = (id: string, pubkey: string) => ({
  id,
  pubkey,
  kind: 7,
  content: '❤️',
  created_at: 2,
  tags: [['e', target]],
});
beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockFetch.mockResolvedValue([]);
});

it.each([me, bob, carol])(
  'offers reactions, Reply/Copy and only own Edit/Delete: %s',
  async (senderPubkey) => {
    const row = { ...message, senderPubkey };
    const { result } = renderHook(() =>
      useGroupMessageActions({ messages: [row], myPubkey: me, groupId: 'group' }),
    );
    await act(async () => {});
    const props = result.current.propsForMessage(row);
    expect(props.onToggleReaction).toBeDefined();
    act(() => props.onLongPress?.());
    const action = result.current.actionsForMessage!;
    expect(action).toMatchObject({
      targetId: target,
      authorPubkey: senderPubkey,
      copyText: 'hello',
    });
    act(() => result.current.startReply());
    expect(result.current.replyTo).toBe(target);
    expect(result.current.replyQuote).toMatchObject({ text: 'hello', fromMe: senderPubkey === me });
    expect(result.current.actionsForMessage).toBeNull();
    act(() => result.current.cancelReply());
    expect(result.current.replyTo).toBeUndefined();
    expect(
      messageEditDelete({ isMarmot: true, ...action, isPlainText: !!action.copyText }),
    ).toEqual({
      canEdit: senderPubkey === me,
      canDelete: senderPubkey === me,
    });
  },
);

it('aggregates multiple members, rejects forged un-reacts, and toggles our reaction off', async () => {
  jest.useFakeTimers();
  const { result } = renderHook(() =>
    useGroupMessageActions({ messages: [message], myPubkey: me, groupId: 'group' }),
  );
  await act(async () => {});
  act(() => {
    mockEmit(reaction('r-bob', bob));
    mockEmit(reaction('r-carol', carol));
    mockEmit(reaction('r-me', me));
    mockEmit({ ...reaction('forged', carol), kind: 5, tags: [['e', 'r-bob']] });
  });
  expect(result.current.reactionsByTarget.size).toBe(0);
  act(() => jest.advanceTimersByTime(100));
  expect(result.current.reactionsByTarget.get(target)?.byEmoji['❤️'].length).toBe(3);
  await act(async () => result.current.propsForMessage(message).onToggleReaction?.('❤️', 'r-me'));
  expect(mockDelete).toHaveBeenCalledWith('r-me');
  expect(result.current.reactionsByTarget.get(target)?.byEmoji['❤️'].length).toBe(2);
  act(() => {
    mockEmit({ ...reaction('delete', bob), kind: 5, tags: [['e', 'r-bob']] });
    jest.advanceTimersByTime(100);
  });
  expect(result.current.reactionsByTarget.get(target)?.byEmoji['❤️'].length).toBe(1);
  jest.useRealTimers();
});

it('publishes to the received message author and leaves NIP-17 groups unchanged', async () => {
  const { result, rerender } = renderHook(
    ({ groupId }: { groupId: string | null }) =>
      useGroupMessageActions({ messages: [message], myPubkey: me, groupId }),
    { initialProps: { groupId: 'group' as string | null } },
  );
  await act(async () => result.current.propsForMessage(message).onToggleReaction?.('👍', null));
  await waitFor(() =>
    expect(mockPublish).toHaveBeenCalledWith({
      emoji: '👍',
      targetEventId: target,
      targetAuthorPubkey: bob,
      targetEventKind: 14,
    }),
  );
  rerender({ groupId: null });
  expect(result.current.propsForMessage(message)).toEqual({});
});

it('keeps row handlers stable when opening an action sheet', async () => {
  const messages = [message];
  const { result } = renderHook(() =>
    useGroupMessageActions({ messages, myPubkey: me, groupId: 'group' }),
  );
  await act(async () => {});
  const before = result.current.propsForMessage(message);
  act(() => before.onLongPress?.());
  expect(result.current.propsForMessage(message).onLongPress).toBe(before.onLongPress);
});

it('reloads group history on focus so reactions received while blurred are shown', async () => {
  const messages = [message];
  const { result, rerender } = renderHook(() =>
    useGroupMessageActions({ messages, myPubkey: me, groupId: 'group' }),
  );
  await act(async () => {});
  mockFocused = false;
  rerender({});
  await act(async () => {});
  mockFetch.mockResolvedValue([reaction('missed', bob)]);
  mockFocused = true;
  rerender({});
  await waitFor(() =>
    expect(result.current.reactionsByTarget.get(target)?.byEmoji['❤️']).toEqual([bob]),
  );
});

it('offers Reply and reactions for a location without treating it as editable text', async () => {
  const row = { ...message, senderPubkey: me, text: 'geo:51.5,-0.1' };
  const { result } = renderHook(() =>
    useGroupMessageActions({ messages: [row], myPubkey: me, groupId: 'group' }),
  );
  await act(async () => {});
  act(() => result.current.propsForMessage(row).onLongPress?.());
  const action = result.current.actionsForMessage!;
  expect(action.copyText).toBeUndefined();
  expect(messageEditDelete({ isMarmot: true, ...action, isPlainText: !!action.copyText })).toEqual({
    canEdit: false,
    canDelete: true,
  });
  act(() => result.current.startReply());
  expect(result.current.replyTo).toBe(target);
});
