/**
 * Unit tests for the ephemeral typing-indicator hook (#992).
 *
 * Pins the three behaviours that aren't obvious from the event shape alone
 * (which `nostrTyping.test.ts` already covers):
 *
 *   1. Receiving: each incoming ping flips `isPeerTyping` true and it
 *      auto-clears PEER_TYPING_TIMEOUT_MS after the *last* ping.
 *   2. Sending is throttled to one publish per SEND_THROTTLE_MS.
 *   3. Sending is nsec-only — Amber / NIP-46 signers receive but never
 *      broadcast (a keystroke-frequency signer prompt is unacceptable).
 *   4. Unmount tears down the subscription.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useTypingIndicator } from './useTypingIndicator';
import { useNostr } from '../contexts/NostrContext';
import { getMemoisedSecretKey } from '../contexts/nostrSecretKeyCache';
import { subscribeTyping, publishTypingIndicator } from '../services/nostrTyping';

jest.mock('../contexts/NostrContext', () => ({ useNostr: jest.fn() }));
jest.mock('../contexts/nostrSecretKeyCache', () => ({ getMemoisedSecretKey: jest.fn() }));
jest.mock('../services/nostrTyping', () => ({
  subscribeTyping: jest.fn(),
  publishTypingIndicator: jest.fn(),
}));

const mockedUseNostr = useNostr as jest.MockedFunction<typeof useNostr>;
const mockedGetKey = getMemoisedSecretKey as jest.MockedFunction<typeof getMemoisedSecretKey>;
const mockedSubscribe = subscribeTyping as jest.MockedFunction<typeof subscribeTyping>;
const mockedPublish = publishTypingIndicator as jest.MockedFunction<typeof publishTypingIndicator>;

const MY_PK = 'a'.repeat(64);
const PEER_PK = 'b'.repeat(64);
const RELAYS = [{ url: 'wss://r.example', read: true, write: true }];

function setNostr(overrides: Partial<ReturnType<typeof useNostr>> = {}) {
  mockedUseNostr.mockReturnValue({
    pubkey: MY_PK,
    signerType: 'nsec',
    relays: RELAYS,
    // The hook only reads pubkey/signerType/relays; the rest of the context
    // is irrelevant here.
    ...overrides,
  } as unknown as ReturnType<typeof useNostr>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedSubscribe.mockReturnValue(() => {});
  mockedGetKey.mockResolvedValue(new Uint8Array(32));
  mockedPublish.mockResolvedValue(undefined);
});

describe('useTypingIndicator — receive', () => {
  it('flips isPeerTyping on a ping and auto-clears after the timeout', () => {
    jest.useFakeTimers();
    setNostr();
    let onTyping = () => {};
    mockedSubscribe.mockImplementation((input) => {
      onTyping = input.onTyping;
      return () => {};
    });

    const { result } = renderHook(() => useTypingIndicator(PEER_PK));
    expect(result.current.isPeerTyping).toBe(false);

    act(() => onTyping());
    expect(result.current.isPeerTyping).toBe(true);

    // Still typing just before the timeout…
    act(() => jest.advanceTimersByTime(5999));
    expect(result.current.isPeerTyping).toBe(true);
    // …and cleared once 6s of silence elapse.
    act(() => jest.advanceTimersByTime(1));
    expect(result.current.isPeerTyping).toBe(false);
    jest.useRealTimers();
  });

  it('does not subscribe when there is no peer', () => {
    setNostr();
    renderHook(() => useTypingIndicator(null));
    expect(mockedSubscribe).not.toHaveBeenCalled();
  });

  it('tears down the subscription on unmount', () => {
    setNostr();
    const unsub = jest.fn();
    mockedSubscribe.mockReturnValue(unsub);
    const { unmount } = renderHook(() => useTypingIndicator(PEER_PK));
    expect(mockedSubscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});

describe('useTypingIndicator — send', () => {
  it('throttles publishes to one per SEND_THROTTLE_MS', async () => {
    jest.useFakeTimers();
    setNostr();
    const { result } = renderHook(() => useTypingIndicator(PEER_PK));

    await act(async () => {
      result.current.notifyTyping();
      result.current.notifyTyping(); // within the window — throttled
    });
    await waitFor(() => expect(mockedPublish).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(4001);
      result.current.notifyTyping(); // window elapsed — publishes again
    });
    await waitFor(() => expect(mockedPublish).toHaveBeenCalledTimes(2));
    jest.useRealTimers();
  });

  it('never publishes for a non-nsec signer (Amber / NIP-46 receive-only)', async () => {
    setNostr({ signerType: 'amber' });
    const { result } = renderHook(() => useTypingIndicator(PEER_PK));
    await act(async () => {
      result.current.notifyTyping();
    });
    expect(mockedPublish).not.toHaveBeenCalled();
    // But such signers still subscribe to *receive* typing.
    expect(mockedSubscribe).toHaveBeenCalledTimes(1);
  });
});
