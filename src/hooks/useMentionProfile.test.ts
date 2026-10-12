import { act, renderHook } from '@testing-library/react-native';
import { useMentionProfile } from './useMentionProfile';
import { __resetMentionProfilesForTests } from '../services/nostrMentionProfiles';
import { querySyncAbortable } from '../services/relayQuery';

let mockFocused = true;
const mockVerifiedFetch = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => (() => void) | undefined) => {
    const React = jest.requireActual<typeof import('react')>('react');
    const focused = mockFocused;
    React.useEffect(() => (focused ? callback() : undefined), [callback, focused]);
  },
}));
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({ relays: [{ url: 'wss://read', read: true }] }),
}));
jest.mock('../services/nostrService', () => ({
  fetchProfile: (...args: unknown[]) => mockVerifiedFetch(...args),
}));
jest.mock('../services/nostrPool', () => ({ pool: {}, trackRelays: jest.fn() }));
jest.mock('../services/relayQuery', () => ({ querySyncAbortable: jest.fn() }));
jest.mock('../services/zapSenderProfileStorage', () => ({
  peekSync: () => null,
  get: async () => null,
  getMany: async () => new Map(),
  setMany: jest.fn(),
}));
const query = jest.mocked(querySyncAbortable);
beforeEach(() => {
  jest.useFakeTimers();
  mockFocused = true;
  jest.clearAllMocks();
  __resetMentionProfilesForTests();
  query.mockResolvedValue([]);
  mockVerifiedFetch.mockResolvedValue(null);
});
afterEach(() => {
  __resetMentionProfilesForTests();
  jest.useRealTimers();
});

it('shares one cosmetic batch across mention hooks without verified payment lookups', async () => {
  const a = renderHook(() => useMentionProfile('a'));
  const b = renderHook(() => useMentionProfile('b'));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60);
  });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][2].authors).toEqual(['a', 'b']);
  expect(mockVerifiedFetch).not.toHaveBeenCalled();
  a.unmount();
  b.unmount();
});

it('does not query while blurred, and cancels the subscription on blur before unmount', async () => {
  mockFocused = false;
  const hook = renderHook(() => useMentionProfile('a'));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60);
  });
  expect(query).not.toHaveBeenCalled();
  expect(mockVerifiedFetch).not.toHaveBeenCalled();
  query.mockImplementation(
    (_pool, _relays, _filter, opts) =>
      new Promise((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve([]), { once: true });
      }),
  );
  mockFocused = true;
  hook.rerender({});
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60);
  });
  const signal = query.mock.calls[0][3].signal!;
  expect(signal.aborted).toBe(false);
  mockFocused = false;
  hook.rerender({});
  expect(signal.aborted).toBe(true);
  hook.unmount();
});
