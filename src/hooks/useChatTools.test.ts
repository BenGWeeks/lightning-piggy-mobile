import { act, renderHook } from '@testing-library/react-native';
import { buildConversationItems, type ConversationMessageInput } from '../utils/conversationItems';
import { useGroupTimeline } from './useGroupTimeline';
import { useChatTools } from './useChatTools';
import { useLiveMessageIndicator } from './useLiveMessageIndicator';
import type { RootStackParamList } from '../navigation/types';

const mockNavigation = { navigate: jest.fn(), setParams: jest.fn() };
let mockParams: { jumpToMessage?: string } = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockParams }),
}));
const info: RootStackParamList['ChatInfo'] = {
  name: 'Peer',
  protocol: 'nip17',
  chatId: null,
  deviceCounts: [],
  relays: [],
};
const target: RootStackParamList['ChatMedia']['target'] = {
  screen: 'Conversation',
  params: { pubkey: 'peer', name: 'Peer', protocol: 'nip17' },
};
const messages = [{ id: 'old', text: 'needle', createdAt: 1 }];
const clear = async () => {};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockParams = {};
});
afterEach(() => jest.useRealTimers());

it.each(['search', 'attachment'])(
  'holds the live edge before a %s jump and cancels pending auto-scroll',
  (source) => {
    const scrollToLatest = jest.fn();
    const jump = jest.fn((_id: string) => true);
    const hook = renderHook(
      ({ entries }: { entries: typeof messages }) => {
        const live = useLiveMessageIndicator({ scope: 'chat', entries, scrollToLatest });
        const tools = useChatTools(
          entries,
          info,
          target,
          jump,
          clear,
          live.leaveEdge,
          entries.map((m) => m.id),
        );
        return { live, tools };
      },
      { initialProps: { entries: messages } },
    );
    // Schedule a live-message scroll immediately before jumping into history.
    const updated = [...messages, { id: 'new', text: 'latest', createdAt: 2 }];
    hook.rerender({ entries: updated });
    jump.mockImplementation(() => {
      // The hold must already be active when the list starts landing the jump.
      hook.result.current.live.onContentSizeChange();
      hook.result.current.live.onScroll({
        nativeEvent: {
          contentOffset: { y: 0 },
          contentSize: { height: 1000 },
          layoutMeasurement: { height: 500 },
        },
      } as Parameters<typeof hook.result.current.live.onScroll>[0]);
      return true;
    });
    if (source === 'search') {
      act(() => {
        hook.result.current.tools.search.open();
        hook.result.current.tools.search.change('needle');
      });
    } else {
      mockParams = { jumpToMessage: 'old' };
      hook.rerender({ entries: updated });
      expect(mockNavigation.setParams).toHaveBeenCalledWith({ jumpToMessage: undefined });
    }
    expect(jump).toHaveBeenCalledWith('old');
    act(() => {
      hook.result.current.live.onContentSizeChange();
      jest.advanceTimersByTime(100);
    });
    expect(scrollToLatest).not.toHaveBeenCalled();
    expect(hook.result.current.live.atEdge).toBe(false);
    // Readers can deliberately resume following the latest message.
    act(() => hook.result.current.live.jumpToLatest());
    expect(scrollToLatest).toHaveBeenCalledWith(true);
  },
);

it.each(['nip17', 'marmot'])(
  'searches only rendered DM rows for %s, excluding votes and duplicate invoices',
  () => {
    const invoice = 'lnbc210n1p' + 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.repeat(2);
    const raw: ConversationMessageInput[] = [
      { id: 'visible', text: 'needle', createdAt: 1, fromMe: false, wireKind: 14 },
      { id: 'vote', text: '[POLL_VOTE] needle 1', createdAt: 2, fromMe: false, wireKind: 14 },
      { id: 'note', text: `needle ${invoice}`, createdAt: 3, fromMe: false, wireKind: 14 },
      {
        id: 'card',
        text: JSON.stringify({
          kind: 16,
          type: 'payment',
          orderId: 'order',
          items: [],
          message: '',
          payment: { method: 'lightning', value: invoice },
        }),
        createdAt: 4,
        fromMe: false,
        wireKind: 16,
      },
    ];
    const rows = buildConversationItems(raw, []);
    const ids = rows.filter((row) => row.id.startsWith('dm-')).map((row) => row.id.slice(3));
    expect(ids).not.toContain('vote');
    expect(ids).not.toContain('note');
    const jump = jest.fn((_id: string) => true);
    mockParams = { jumpToMessage: 'note' };
    const hook = renderHook(() => useChatTools(raw, info, target, jump, clear, jest.fn(), ids));
    expect(jump).not.toHaveBeenCalled();
    act(() => {
      hook.result.current.search.open();
      hook.result.current.search.change('needle');
    });
    expect(hook.result.current.search.count).toBe(1);
    expect(jump).toHaveBeenCalledWith('visible');
    act(() => hook.result.current.search.move(1));
    expect(jump.mock.calls.every(([id]) => id === 'visible')).toBe(true);
  },
);

it.each(['nip17', 'marmot'])(
  'excludes hidden group votes from %s search and attachment jumps',
  () => {
    const raw = [
      { id: 'visible', text: 'needle', createdAt: 1, senderPubkey: 'peer' },
      { id: 'vote', text: '[POLL_VOTE] needle 1', createdAt: 2, senderPubkey: 'peer' },
    ];
    const jump = jest.fn((_id: string) => true);
    mockParams = { jumpToMessage: 'vote' };
    const hook = renderHook(() => {
      const { rows } = useGroupTimeline({
        messages: raw,
        myPubkey: 'owner',
        memberNameByPubkey: new Map(),
        formatLocale: 'en',
        deviceNotices: [],
      });
      return useChatTools(
        raw,
        info,
        target,
        jump,
        clear,
        jest.fn(),
        rows.map((row) => row.id),
      );
    });
    expect(jump).not.toHaveBeenCalled();
    act(() => {
      hook.result.current.search.open();
      hook.result.current.search.change('needle');
    });
    expect(hook.result.current.search.count).toBe(1);
    expect(jump).toHaveBeenCalledWith('visible');
  },
);

it('falls back at the original deadline using the latest rows and callbacks during message updates', () => {
  mockParams = { jumpToMessage: 'missing' };
  const originalJump = jest.fn(() => true);
  const latestJump = jest.fn(() => true);
  const originalLeave = jest.fn();
  const latestLeave = jest.fn();
  const hook = renderHook(
    ({
      entries,
      jump,
      leave,
    }: {
      entries: typeof messages;
      jump: (id: string) => boolean;
      leave: (holdMs: number) => void;
    }) =>
      useChatTools(
        entries,
        info,
        target,
        jump,
        clear,
        leave,
        entries.map((m) => m.id),
      ),
    { initialProps: { entries: messages, jump: originalJump, leave: originalLeave } },
  );
  for (let second = 1; second <= 4; second++) {
    act(() => jest.advanceTimersByTime(1000));
    hook.rerender({
      entries: [...messages, { id: `new-${second}`, text: 'latest', createdAt: second + 1 }],
      jump: latestJump,
      leave: latestLeave,
    });
  }
  act(() => jest.advanceTimersByTime(999));
  expect(latestJump).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(latestJump).toHaveBeenCalledWith('new-4');
  expect(latestLeave).toHaveBeenCalledWith(1500);
  expect(originalJump).not.toHaveBeenCalled();
  expect(originalLeave).not.toHaveBeenCalled();
  expect(mockNavigation.setParams).toHaveBeenCalledWith({ jumpToMessage: undefined });
  expect(hook.result.current.highlightedId).toBeNull();
});

it('starts a new deadline when the pending target changes and cancels on unmount', () => {
  mockParams = { jumpToMessage: 'first-missing' };
  const jump = jest.fn(() => true);
  const hook = renderHook(() =>
    useChatTools(messages, info, target, jump, clear, jest.fn(), ['old']),
  );
  act(() => jest.advanceTimersByTime(4000));
  mockParams = { jumpToMessage: 'second-missing' };
  hook.rerender({});
  act(() => jest.advanceTimersByTime(1000));
  expect(jump).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(4000));
  expect(jump).toHaveBeenCalledTimes(1);
  mockParams = { jumpToMessage: 'third-missing' };
  hook.rerender({});
  hook.unmount();
  act(() => jest.advanceTimersByTime(5000));
  expect(jump).toHaveBeenCalledTimes(1);
});

it('uses rows loaded during the wait without restarting the deadline', () => {
  mockParams = { jumpToMessage: 'missing' };
  const jump = jest.fn(() => true);
  const hook = renderHook(
    ({ entries }: { entries: typeof messages }) =>
      useChatTools(
        entries,
        info,
        target,
        jump,
        clear,
        jest.fn(),
        entries.map((m) => m.id),
      ),
    { initialProps: { entries: [] } },
  );
  act(() => jest.advanceTimersByTime(4000));
  hook.rerender({ entries: messages });
  act(() => jest.advanceTimersByTime(1000));
  expect(jump).toHaveBeenCalledWith('old');
});

it('opens a target arriving during the wait and cancels its fallback when params clear', () => {
  mockParams = { jumpToMessage: 'arriving' };
  const jump = jest.fn(() => true);
  const hook = renderHook(
    ({ entries }: { entries: typeof messages }) =>
      useChatTools(
        entries,
        info,
        target,
        jump,
        clear,
        jest.fn(),
        entries.map((m) => m.id),
      ),
    { initialProps: { entries: messages } },
  );
  act(() => jest.advanceTimersByTime(4000));
  const entries = [...messages, { id: 'arriving', text: 'target', createdAt: 2 }];
  hook.rerender({ entries });
  expect(jump).toHaveBeenCalledWith('arriving');
  expect(hook.result.current.highlightedId).toBe('arriving');
  const arrivalJumps = jump.mock.calls.length;
  mockParams = {};
  hook.rerender({ entries });
  act(() => jest.advanceTimersByTime(5000));
  expect(jump).toHaveBeenCalledTimes(arrivalJumps);
  expect(hook.result.current.highlightedId).toBeNull();
});

it.each(['missing', 'old'])('handles rows arriving after the deadline for target %s', (pending) => {
  mockParams = { jumpToMessage: pending };
  const jump = jest.fn(() => true);
  const leave = jest.fn();
  const hook = renderHook(
    ({ entries }: { entries: typeof messages }) =>
      useChatTools(
        entries,
        info,
        target,
        jump,
        clear,
        leave,
        entries.map((m) => m.id),
      ),
    { initialProps: { entries: [] } },
  );
  act(() => jest.advanceTimersByTime(6000));
  expect(jump).not.toHaveBeenCalled();
  expect(mockNavigation.setParams).not.toHaveBeenCalled();
  hook.rerender({ entries: [...messages, { id: 'newest', text: 'latest', createdAt: 2 }] });
  if (pending === 'missing') expect(jump).toHaveBeenCalledTimes(1);
  expect(jump).toHaveBeenCalledWith(pending === 'old' ? 'old' : 'newest');
  if (pending === 'old') expect(jump).not.toHaveBeenCalledWith('newest');
  expect(leave).toHaveBeenCalledWith(1500);
  expect(mockNavigation.setParams).toHaveBeenCalledWith({ jumpToMessage: undefined });
  expect(hook.result.current.highlightedId).toBe(pending === 'old' ? 'old' : null);
});

it('waits for the replacement target deadline after the empty-chat deadline expires', () => {
  mockParams = { jumpToMessage: 'first-missing' };
  const jump = jest.fn(() => true);
  const hook = renderHook(
    ({ entries }: { entries: typeof messages }) =>
      useChatTools(
        entries,
        info,
        target,
        jump,
        clear,
        jest.fn(),
        entries.map((m) => m.id),
      ),
    { initialProps: { entries: [] } },
  );
  act(() => jest.advanceTimersByTime(6000));
  mockParams = { jumpToMessage: 'second-missing' };
  hook.rerender({ entries: messages });
  act(() => jest.advanceTimersByTime(4999));
  expect(jump).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(jump).toHaveBeenCalledTimes(1);
  expect(jump).toHaveBeenCalledWith('old');
});
