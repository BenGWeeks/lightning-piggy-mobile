import { act, renderHook } from '@testing-library/react-native';
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
    const jump = jest.fn(() => true);
    const hook = renderHook(
      ({ entries }: { entries: typeof messages }) => {
        const live = useLiveMessageIndicator({ scope: 'chat', entries, scrollToLatest });
        const tools = useChatTools(entries, info, target, jump, clear, live.leaveEdge);
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
