import { renderHook, act } from '@testing-library/react-native';
import { useConversationComposerActions } from './useConversationComposerActions';
import { getDmDeliveryStatus, __resetDmDeliveryStore } from '../utils/dmDeliveryStore';
import type { SendHooks, SendResult } from '../contexts/useMessageSend';
import type { DeliveryStatus } from '../utils/dmDeliveryStatus';

// Mock the Nostr provider so the hook can run without a full context tree.
// `mockSendDirectMessage` is overridden per-test to drive the send outcome.
// `mock`-prefixed so jest's mock-hoisting allows referencing them in the factory.
const mockSendDirectMessage = jest.fn();
const mockAppendLocalDmMessage = jest.fn().mockResolvedValue(undefined);
jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({
    sendDirectMessage: mockSendDirectMessage,
    sendFileMessage: jest.fn(),
    appendLocalDmMessage: mockAppendLocalDmMessage,
    isLoggedIn: true,
    signEvent: jest.fn(),
    relays: [],
  }),
  useNostrContacts: () => ({ contacts: [] }),
}));

// Spy on the branded alert so we can assert it does / doesn't fire.
const mockAlert = jest.fn();
jest.mock('../components/BrandedAlert', () => ({
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));

const EVENT_ID = 'rumor-event-id-857';
const PUBKEY = 'a'.repeat(64);
// Target relays the send fans out to — carried on onRumorReady so the
// pending/failed status can seed its relay breakdown for the info sheet.
const RELAYS = ['wss://a', 'wss://b'];

function setup() {
  const setMessages = jest.fn();
  const setDraft = jest.fn();
  const { result } = renderHook(() =>
    useConversationComposerActions({
      pubkey: PUBKEY,
      name: 'Big Piggy',
      draft: 'hi',
      setDraft,
      setMessages,
      setAttachPanelOpen: jest.fn(),
      setContactPickerOpen: jest.fn(),
      setGifPickerOpen: jest.fn(),
      setVoiceSheetOpen: jest.fn(),
    }),
  );
  return { result, setMessages };
}

describe('useConversationComposerActions.sendText — optimistic + failed-keep-bubble (#857)', () => {
  beforeEach(() => {
    __resetDmDeliveryStore();
    mockSendDirectMessage.mockReset();
    mockAppendLocalDmMessage.mockClear();
    mockAlert.mockReset();
  });

  it('paints a pending bubble immediately, then settles it to delivered', async () => {
    const delivered: DeliveryStatus = {
      delivered: true,
      relayResults: { 'wss://a': 'ok', 'wss://b': 'ok' },
      eventId: EVENT_ID,
      kind: 14,
    };
    let pendingSeenInStore = false;
    mockSendDirectMessage.mockImplementation(
      async (_pk: string, _text: string, hooks?: SendHooks): Promise<SendResult> => {
        // The hook fires onRumorReady synchronously — at that instant the store
        // must already carry a PENDING status (the instant bubble).
        hooks?.onRumorReady?.({ eventId: EVENT_ID, kind: 14, relays: RELAYS });
        const seeded = getDmDeliveryStatus(EVENT_ID);
        pendingSeenInStore = seeded?.pending === true;
        // The pending status seeds its relay breakdown from the target relays
        // (the missing-relays fix): the info sheet can list them while in flight.
        expect(Object.keys(seeded?.relayResults ?? {})).toEqual(RELAYS);
        return { success: true, delivery: delivered };
      },
    );

    const { result, setMessages } = setup();
    await act(async () => {
      await result.current.handleSend?.();
    });

    // Bubble appended optimistically before the send resolved. The row id is
    // `local-` prefixed (so the echo dedups it), and it carries `rumorId` —
    // the stable delivery-store key shared with the echo.
    expect(setMessages).toHaveBeenCalled();
    expect(mockAppendLocalDmMessage).toHaveBeenCalledWith(
      PUBKEY,
      expect.objectContaining({
        id: `local-${EVENT_ID}`,
        rumorId: EVENT_ID,
        fromMe: true,
        wireKind: 14,
      }),
    );
    expect(pendingSeenInStore).toBe(true);
    // Settled to delivered after the send resolved.
    expect(getDmDeliveryStatus(EVENT_ID)?.delivered).toBe(true);
    expect(getDmDeliveryStatus(EVENT_ID)?.pending).toBeFalsy();
  });

  it('keeps the bubble on a failed send (red status in store) instead of dropping it', async () => {
    const failedDelivery: DeliveryStatus = {
      delivered: false,
      relayResults: { 'wss://a': 'failed', 'wss://b': 'failed' },
      eventId: EVENT_ID,
      kind: 14,
    };
    mockSendDirectMessage.mockImplementation(
      async (_pk: string, _text: string, hooks?: SendHooks): Promise<SendResult> => {
        hooks?.onRumorReady?.({ eventId: EVENT_ID, kind: 14, relays: RELAYS });
        return { success: false, delivery: failedDelivery, error: 'all relays down' };
      },
    );

    const { result } = setup();
    await act(async () => {
      await result.current.handleSend?.();
    });

    // The bubble survives: a settled, non-pending, failed status sits in the
    // store keyed by eventId — the red tick the user taps to Re-publish.
    const status = getDmDeliveryStatus(EVENT_ID);
    expect(status?.pending).toBeFalsy();
    expect(status?.delivered).toBe(false);
    // No dead-end alert — the bubble itself carries the failure.
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('watchdog flips the bubble to failed if the send hangs (offline, never settles)', async () => {
    jest.useFakeTimers();
    try {
      // Offline: the send never resolves (pool.publish promises hang). The
      // watchdog must still flip the pending bubble to a red failed tick.
      mockSendDirectMessage.mockImplementation(
        (_pk: string, _text: string, hooks?: SendHooks): Promise<SendResult> => {
          hooks?.onRumorReady?.({ eventId: EVENT_ID, kind: 14, relays: RELAYS });
          return new Promise<SendResult>(() => {}); // never settles
        },
      );

      const { result } = setup();
      act(() => {
        void result.current.handleSend?.();
      });
      // Pending immediately.
      expect(getDmDeliveryStatus(EVENT_ID)?.pending).toBe(true);
      // After the watchdog window, the bubble settles to failed (not pending).
      act(() => {
        jest.advanceTimersByTime(13_000);
      });
      const status = getDmDeliveryStatus(EVENT_ID);
      expect(status?.pending).toBeFalsy();
      expect(status?.delivered).toBe(false);
      // The hung-send failed status still carries the attempted relays (seeded
      // as failed) so the info sheet lists them — not an empty breakdown.
      expect(Object.keys(status?.relayResults ?? {})).toEqual(RELAYS);
    } finally {
      jest.useRealTimers();
    }
  });

  it('settles to the finalized breakdown when slow relays ack after the early resolve', async () => {
    const earlySingle: DeliveryStatus = {
      delivered: true,
      relayResults: { 'wss://a': 'ok' },
      eventId: EVENT_ID,
      kind: 14,
    };
    const finalDouble: DeliveryStatus = {
      delivered: true,
      relayResults: { 'wss://a': 'ok', 'wss://b': 'ok' },
      eventId: EVENT_ID,
      kind: 14,
    };
    // Capture the finalize callback so the test fires it deterministically
    // (rather than racing a timer against the early assertion).
    let finalize: ((d: DeliveryStatus) => void) | undefined;
    mockSendDirectMessage.mockImplementation(
      async (_pk: string, _text: string, hooks?: SendHooks): Promise<SendResult> => {
        hooks?.onRumorReady?.({ eventId: EVENT_ID, kind: 14, relays: RELAYS });
        finalize = hooks?.onDeliveryFinalized;
        return { success: true, delivery: earlySingle };
      },
    );

    const { result } = setup();
    await act(async () => {
      await result.current.handleSend?.();
    });
    // Early: single relay.
    expect(Object.keys(getDmDeliveryStatus(EVENT_ID)?.relayResults ?? {})).toHaveLength(1);
    // Slow relay acks → the finalized breakdown upgrades the store to both.
    act(() => finalize?.(finalDouble));
    expect(Object.keys(getDmDeliveryStatus(EVENT_ID)?.relayResults ?? {})).toHaveLength(2);
  });
});
