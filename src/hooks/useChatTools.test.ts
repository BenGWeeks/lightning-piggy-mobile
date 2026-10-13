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
  params: { pubkey: 'peer', name: 'Peer' },
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
