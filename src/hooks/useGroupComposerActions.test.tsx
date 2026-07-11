/**
 * Unit tests for useGroupComposerActions optimistic-bubble + failure-path
 * semantics (#1033). The 1:1 sibling is useConversationComposerActions.test.tsx.
 *
 * Key assertions:
 *  1. `onRumorReady` fires (and the bubble is appended) BEFORE any signing —
 *     verified by passing a signer that never resolves; the row still appears.
 *  2. Failure path removes the optimistic row from state + storage so a
 *     never-published message doesn't linger in the thread.
 *  3. The 'Saved on relay, not on device' case (appendGroupMessage throws after
 *     a successful relay send) does NOT remove the row.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useGroupComposerActions } from './useGroupComposerActions';
import type { GroupSendHooks } from '../contexts/useGroupMessaging';

// ---------------------------------------------------------------------------
// Mocks — note: jest.mock factories are hoisted to module top and cannot
// reference variables defined in the module body. Use string literals or
// `mock`-prefixed vars (allowed by jest's hoisting heuristic) instead.
// ---------------------------------------------------------------------------

const mockSendGroupMessage = jest.fn();
const mockNotifyGroupMessage = jest.fn();

// MY_PUBKEY referenced inside the mock factory must use the `mock`-prefix
// convention so jest's babel transform doesn't reject the out-of-scope access.
const mockMyPubkey = 'a'.repeat(64);

jest.mock('../contexts/NostrContext', () => ({
  useNostr: () => ({
    sendGroupMessage: mockSendGroupMessage,
    pubkey: mockMyPubkey,
  }),
  notifyGroupMessage: (...args: unknown[]) => mockNotifyGroupMessage(...args),
}));

// Storage mock: track calls and control return values per-test.
const mockAppendGroupMessage = jest.fn();
const mockRemoveGroupMessage = jest.fn();

jest.mock('../services/groupMessagesStorageService', () => ({
  appendGroupMessage: (...args: unknown[]) => mockAppendGroupMessage(...args),
  removeGroupMessage: (...args: unknown[]) => mockRemoveGroupMessage(...args),
}));

const mockAlert = jest.fn();
jest.mock('../components/BrandedAlert', () => ({
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));

// useComposerActions has its own side-effects we don't need for these tests.
jest.mock('./useComposerActions', () => ({
  useComposerActions: () => ({ handleSend: jest.fn() }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MY_PUBKEY = mockMyPubkey;
const GROUP_ID = 'group-001';
const MEMBER_1 = 'b'.repeat(64);
const MEMBER_2 = 'c'.repeat(64);

const GROUP = {
  id: GROUP_ID,
  name: 'Test Group',
  memberPubkeys: [MY_PUBKEY, MEMBER_1, MEMBER_2],
  createdAt: 1700000000,
  updatedAt: 1700000000,
};

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

function setup() {
  const setMessages = jest.fn();
  const scrollToEnd = jest.fn();
  const { result } = renderHook(() =>
    useGroupComposerActions({
      group: GROUP,
      draft: 'hello',
      setDraft: jest.fn(),
      setMessages,
      scrollToEnd,
      setAttachPanelOpen: jest.fn(),
      setGifPickerOpen: jest.fn(),
      setContactPickerOpen: jest.fn(),
      setVoiceSheetOpen: jest.fn(),
    }),
  );
  return { result, setMessages, scrollToEnd };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAlert.mockReset();
  // By default, appendGroupMessage resolves with a list containing one row.
  mockAppendGroupMessage.mockResolvedValue([
    { id: 'local_stub', senderPubkey: MY_PUBKEY, text: 'hello', createdAt: 1700000001 },
  ]);
  mockRemoveGroupMessage.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Test 1: onRumorReady fires before signing
// ---------------------------------------------------------------------------

describe('useGroupComposerActions — onRumorReady fires before any signing (#1033)', () => {
  it('appends the optimistic bubble from onRumorReady even when the signer never resolves', async () => {
    // Signer (underlying send) that NEVER resolves — simulates hung Amber or slow bunker.
    mockSendGroupMessage.mockImplementation(
      (_input: unknown, hooks?: GroupSendHooks): Promise<never> => {
        // onRumorReady fires synchronously before any await.
        hooks?.onRumorReady?.({ rumorId: 'test-rumor-id', kind: 14 });
        // Never resolve — signer is hung.
        return new Promise<never>(() => {});
      },
    );

    const { result, setMessages } = setup();

    // Start the send but don't await it (it'll hang).
    act(() => {
      void result.current.sendText('hello');
    });

    // The in-memory setMessages call happened immediately from onRumorReady.
    expect(setMessages).toHaveBeenCalled();
    // appendGroupMessage was called (fire-and-forget storage write).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mockAppendGroupMessage).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 2: successful send appends the optimistic row
// ---------------------------------------------------------------------------

describe('useGroupComposerActions — successful send appends the optimistic row', () => {
  it('calls appendGroupMessage and does NOT call removeGroupMessage on success', async () => {
    mockSendGroupMessage.mockImplementation(async (_input: unknown, hooks?: GroupSendHooks) => {
      hooks?.onRumorReady?.({ rumorId: 'rumor-ok', kind: 14 });
      return { success: true, wrapsPublished: 6 };
    });

    const { result } = setup();
    await act(async () => {
      await result.current.sendText('hello');
    });

    expect(mockAppendGroupMessage).toHaveBeenCalled();
    expect(mockRemoveGroupMessage).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 3: failure path removes the optimistic row
// ---------------------------------------------------------------------------

describe('useGroupComposerActions — failure path removes the optimistic row (#1033)', () => {
  it('removes the just-appended row from storage when the send fails', async () => {
    mockSendGroupMessage.mockImplementation(async (_input: unknown, hooks?: GroupSendHooks) => {
      hooks?.onRumorReady?.({ rumorId: 'rumor-fail', kind: 14 });
      return { success: false, error: 'all relays rejected' };
    });

    const { result, setMessages } = setup();
    await act(async () => {
      await result.current.sendText('hello');
    });

    // BrandedAlert shown for the failure.
    expect(mockAlert).toHaveBeenCalledWith('Send failed', expect.any(String));

    // setMessages called at least once for the optimistic row.
    expect(setMessages).toHaveBeenCalled();

    // removeGroupMessage called with the group id so the row is retracted.
    expect(mockRemoveGroupMessage).toHaveBeenCalledWith(GROUP_ID, expect.any(String));
  });

  it('does not wipe the visible thread when removeGroupMessage rejects on a transient storage error', async () => {
    // removeGroupMessage now rejects (rather than resolving to []) on a
    // storage write failure — see groupMessagesStorageService.ts. This test
    // pins the caller-side half of that contract: removeOptimisticRow must
    // never let a rejected/empty result reach setMessages, since doing so
    // would wipe the entire visible thread on a transient blip that never
    // touched the persisted data.
    mockRemoveGroupMessage.mockRejectedValue(new Error('transient storage error'));

    mockSendGroupMessage.mockImplementation(async (_input: unknown, hooks?: GroupSendHooks) => {
      hooks?.onRumorReady?.({ rumorId: 'rumor-fail-storage', kind: 14 });
      return { success: false, error: 'all relays rejected' };
    });

    const { result, setMessages } = setup();
    await act(async () => {
      await result.current.sendText('hello');
    });

    expect(mockRemoveGroupMessage).toHaveBeenCalledWith(GROUP_ID, expect.any(String));

    // The regression this guards against: a caller that did
    // `setMessages(await removeGroupMessage(...))` and treated a rejection
    // (or the old `[]`-on-error contract) as "the thread is now empty" would
    // show up here as a bare `[]` reaching setMessages. This hook never does
    // that — removeOptimisticRow only ever removes one specific row via the
    // functional-updater form, and the rejected removeGroupMessage call is
    // caught and ignored, so no setMessages call should ever be a plain
    // (non-function) empty array.
    for (const call of setMessages.mock.calls) {
      const arg = call[0];
      if (Array.isArray(arg)) {
        expect(arg.length).toBeGreaterThan(0);
      }
    }
  });

  it('shows a BrandedAlert and removes the row on a partial send failure', async () => {
    mockSendGroupMessage.mockImplementation(async (_input: unknown, hooks?: GroupSendHooks) => {
      hooks?.onRumorReady?.({ rumorId: 'rumor-partial', kind: 14 });
      return {
        success: false,
        wrapsPublished: 2,
        error: 'Sent to 2 of 5 members. Relay refused wrap for member 3.',
      };
    });

    const { result } = setup();
    await act(async () => {
      await result.current.sendText('hello');
    });

    expect(mockAlert).toHaveBeenCalled();
    expect(mockRemoveGroupMessage).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 4: 'Saved on relay, not on device' case is NOT affected
// ---------------------------------------------------------------------------

describe("useGroupComposerActions — 'Saved on relay, not on device' path intact", () => {
  it('does NOT call removeGroupMessage when appendGroupMessage throws after a successful send', async () => {
    // Storage write throws — but the relay send SUCCEEDED.
    mockAppendGroupMessage.mockRejectedValue(new Error('AsyncStorage full'));

    mockSendGroupMessage.mockImplementation(async (_input: unknown, hooks?: GroupSendHooks) => {
      hooks?.onRumorReady?.({ rumorId: 'rumor-storage-err', kind: 14 });
      return { success: true, wrapsPublished: 5 };
    });

    const { result } = setup();
    await act(async () => {
      await result.current.sendText('hello');
    });

    // The storage-error alert (not the "Send failed" alert) fires.
    expect(mockAlert).toHaveBeenCalledWith('Saved on relay, not on device', expect.any(String));
    // No removal — the message reached the relay.
    expect(mockRemoveGroupMessage).not.toHaveBeenCalled();
  });
});
