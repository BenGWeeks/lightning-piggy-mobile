import { routeNotificationMessage } from './notificationGroupNavigation';
import type { NotificationGroup, NotificationRoutingData } from '../utils/notificationRouting';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function setup() {
  let group: NotificationGroup | undefined;
  let owner = 'owner';
  let route = 'Notifications';
  let stopped = false;
  const listeners = new Set<() => void>();
  const deps = {
    getActivePubkey: () => owner,
    getGroup: jest.fn(() => group),
    navigate: jest.fn((target) => {
      route = target.screen;
      listeners.forEach((report) => report());
    }),
    currentRoute: () => route,
    subscribeState: (report: () => void) => {
      listeners.add(report);
      return () => {
        listeners.delete(report);
      };
    },
    shouldStop: () => stopped,
  };
  return {
    deps,
    listeners,
    hydrate: (value: NotificationGroup) => {
      group = value;
    },
    changeOwner: () => {
      owner = 'other';
    },
    supersede: () => {
      stopped = true;
    },
    leave: () => {
      route = 'Home';
      listeners.forEach((report) => report());
      route = 'Messages';
      listeners.forEach((report) => report());
    },
  };
}

it.each([
  { kind: 'group', groupId: 'marmot:chat' },
  { kind: 'group', marmotGroupId: 'marmot:chat' },
  { kind: 'group', threadKind: 'group', protocol: 'marmot', groupId: 'marmot:chat' },
] satisfies NotificationRoutingData[])(
  'accepts a tap without caller retries, then classifies a hydrated Marmot DM: %j',
  (data) => {
    const state = setup();
    expect(
      routeNotificationMessage({ ...data, owner: 'owner', messageId: 'message' }, state.deps),
    ).toBe(true);
    expect(state.deps.navigate).toHaveBeenLastCalledWith({ screen: 'Messages' });
    jest.advanceTimersByTime(300);
    state.hydrate({ isDm: true, memberPubkeys: ['peer'] });
    jest.advanceTimersByTime(100);
    expect(state.deps.navigate).toHaveBeenLastCalledWith({
      screen: 'Conversation',
      params: { pubkey: 'peer', name: '', protocol: 'marmot', jumpToMessage: 'message' },
    });
    expect(state.listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  },
);

it('routes a resolved placeholder to a real group once hydrated', () => {
  const state = setup();
  routeNotificationMessage(
    {
      kind: 'group',
      threadKind: 'group',
      groupId: 'marmot:group',
      owner: 'owner',
      messageId: 'message',
    },
    state.deps,
  );
  state.hydrate({ isDm: false, memberPubkeys: ['a', 'b'] });
  jest.advanceTimersByTime(100);
  expect(state.deps.navigate).toHaveBeenLastCalledWith({
    screen: 'GroupConversation',
    params: { groupId: 'marmot:group', jumpToMessage: 'message' },
  });
});

it.each(['groupId', 'marmotGroupId'] as const)(
  'leaves unavailable %s alerts on Messages and stops retrying',
  (key) => {
    const state = setup();
    routeNotificationMessage({ kind: 'group', [key]: 'marmot:missing' }, state.deps);
    jest.advanceTimersByTime(10_000);
    expect(state.deps.navigate).toHaveBeenCalledTimes(1);
    expect(state.deps.navigate).toHaveBeenCalledWith({ screen: 'Messages' });
    expect(state.listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  },
);

it.each(['changeOwner', 'supersede', 'leave'] as const)(
  'cancels hydration routing after %s',
  (cancel) => {
    const state = setup();
    routeNotificationMessage({ groupId: 'marmot:chat' }, state.deps);
    state[cancel]();
    state.hydrate({ isDm: true, memberPubkeys: ['peer'] });
    jest.advanceTimersByTime(100);
    expect(state.deps.navigate).toHaveBeenCalledTimes(1);
    expect(state.listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  },
);

it('opens an already hydrated group immediately without a retry listener', () => {
  const state = setup();
  state.hydrate({ isDm: false, memberPubkeys: ['a', 'b'] });
  routeNotificationMessage({ groupId: 'marmot:group', messageId: 'message' }, state.deps);
  expect(state.deps.navigate).toHaveBeenCalledWith({
    screen: 'GroupConversation',
    params: { groupId: 'marmot:group', jumpToMessage: 'message' },
  });
  expect(state.listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

it('opens a canonical Marmot DM without waiting for group hydration', () => {
  const state = setup();
  routeNotificationMessage(
    {
      threadKind: 'dm',
      protocol: 'marmot',
      groupId: 'marmot:chat',
      conversationPubkey: 'peer',
      messageId: 'message',
    },
    state.deps,
  );
  expect(state.deps.navigate).toHaveBeenCalledWith({
    screen: 'Conversation',
    params: { pubkey: 'peer', name: '', protocol: 'marmot', jumpToMessage: 'message' },
  });
  expect(state.listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});
