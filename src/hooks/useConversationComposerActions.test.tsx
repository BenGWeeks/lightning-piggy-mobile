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
        hooks?.onRumorReady?.({ eventId: EVENT_ID, kind: 14 });
        pendingSeenInStore = getDmDeliveryStatus(EVENT_ID)?.pending === true;
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
        hooks?.onRumorReady?.({ eventId: EVENT_ID, kind: 14 });
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
        hooks?.onRumorReady?.({ eventId: EVENT_ID, kind: 14 });
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
