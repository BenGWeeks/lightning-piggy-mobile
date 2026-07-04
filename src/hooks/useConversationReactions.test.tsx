/**
 * Unit tests for the two blocking reaction bugs fixed in #205:
 *
 *  1. Removal-before-publish race — un-reacting before `publishReaction`
 *     resolves must retract the REAL kind-7 id (not the `local-react-*`
 *     placeholder, which is a no-op on relays and would resurface the
 *     reaction on next load).
 *  2. Received kind-5 deletions — a peer retracting their reaction must be
 *     reflected locally: the load path fetches kind-5s for the reactions it
 *     learned about and drops the corresponding pill.
 *
 * The hook takes every Nostr dependency as a prop, so no context/network
 * mocking is needed — we hand it jest.fn() fakes and drive the toggles.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useConversationReactions } from './useConversationReactions';
import type { ConversationMessageInput, Item } from '../utils/conversationItems';
import { isOptimisticReactionId } from '../utils/reactions';

jest.mock('../components/BrandedAlert', () => ({
  __esModule: true,
  Alert: { alert: jest.fn() },
}));

const MY_PK = '0'.repeat(64);
const PEER_PK = 'b'.repeat(64);
const TARGET = '1'.repeat(64);

// A minimal sent-message Item carrying the reaction target id.
const sentItem = {
  kind: 'message',
  rumorId: TARGET,
  fromMe: true,
  wireKind: 14,
} as unknown as Item;

function makeParams(overrides: Partial<Parameters<typeof useConversationReactions>[0]> = {}) {
  return {
    messages: [] as ConversationMessageInput[],
    myPubkey: MY_PK,
    peerPubkey: PEER_PK,
    fetchReactionsForMessages: jest.fn().mockResolvedValue([]),
    publishReaction: jest.fn().mockResolvedValue('real-id'),
    deleteReaction: jest.fn().mockResolvedValue(true),
    fetchReactionDeletions: jest.fn().mockResolvedValue([]),
    onZapMessage: jest.fn(),
    ...overrides,
  };
}

describe('useConversationReactions — removal before publish resolves', () => {
  it('retracts the REAL kind-7 id (not the local placeholder) when un-reacted mid-publish', async () => {
    let resolvePublish!: (v: string | null) => void;
    const publishReaction = jest
      .fn()
      .mockImplementation(() => new Promise<string | null>((res) => (resolvePublish = res)));
    const deleteReaction = jest.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useConversationReactions(makeParams({ publishReaction, deleteReaction })),
    );

    // Tap to add — the optimistic pill appears while the publish is in flight.
    act(() => {
      result.current.buildOnToggleReaction(sentItem)!('👍', null);
    });
    await waitFor(() =>
      expect(result.current.reactionsByTarget.get(TARGET)?.myReactions['👍']).toBeDefined(),
    );
    const optimisticId = result.current.reactionsByTarget.get(TARGET)!.myReactions['👍'];
    expect(isOptimisticReactionId(optimisticId)).toBe(true);

    // Tap again to remove BEFORE the publish resolves. The pill disappears and
    // NO delete is issued yet (the real id isn't known — a delete of the
    // placeholder would be a no-op on relays).
    act(() => {
      result.current.buildOnToggleReaction(sentItem)!('👍', optimisticId);
    });
    expect(result.current.reactionsByTarget.get(TARGET)).toBeUndefined();
    expect(deleteReaction).not.toHaveBeenCalled();

    // The publish finally acks with the real id → the hook must retract THAT.
    await act(async () => {
      resolvePublish('real-id');
    });
    await waitFor(() => expect(deleteReaction).toHaveBeenCalledWith('real-id'));
    // And the placeholder was never (uselessly) deleted.
    expect(deleteReaction).not.toHaveBeenCalledWith(optimisticId);
    // Pill stays gone.
    expect(result.current.reactionsByTarget.get(TARGET)).toBeUndefined();
  });
});

describe('useConversationReactions — received kind-5 deletion', () => {
  it("drops a peer's pill when a matching kind-5 retraction is fetched on load", async () => {
    const messages: ConversationMessageInput[] = [
      { id: 'dm-1', fromMe: false, text: 'hi', createdAt: 100, rumorId: TARGET },
    ];
    const fetchReactionsForMessages = jest.fn().mockResolvedValue([
      {
        id: 'peer-r1',
        pubkey: PEER_PK,
        kind: 7,
        content: '❤️',
        created_at: 100,
        tags: [
          ['e', TARGET],
          ['p', MY_PK],
        ],
      },
    ]);
    const fetchReactionDeletions = jest
      .fn()
      .mockResolvedValue([
        { id: 'del1', pubkey: PEER_PK, created_at: 101, tags: [['e', 'peer-r1']] },
      ]);

    const { result } = renderHook(() =>
      useConversationReactions(
        makeParams({ messages, fetchReactionsForMessages, fetchReactionDeletions }),
      ),
    );

    // The deletion fetch is keyed on the reaction id we just learned about.
    await waitFor(() => expect(fetchReactionDeletions).toHaveBeenCalledWith(['peer-r1']));
    // After applying the retraction, the ❤️ pill is gone.
    await waitFor(() => expect(result.current.reactionsByTarget.get(TARGET)).toBeUndefined());
  });

  it("keeps the pill when a kind-5's author is not the reaction author (NIP-09)", async () => {
    const messages: ConversationMessageInput[] = [
      { id: 'dm-1', fromMe: false, text: 'hi', createdAt: 100, rumorId: TARGET },
    ];
    const fetchReactionsForMessages = jest.fn().mockResolvedValue([
      {
        id: 'peer-r1',
        pubkey: PEER_PK,
        kind: 7,
        content: '❤️',
        created_at: 100,
        tags: [
          ['e', TARGET],
          ['p', MY_PK],
        ],
      },
    ]);
    // A third party (not PEER_PK) tries to retract PEER_PK's reaction.
    const fetchReactionDeletions = jest
      .fn()
      .mockResolvedValue([
        { id: 'del1', pubkey: 'c'.repeat(64), created_at: 101, tags: [['e', 'peer-r1']] },
      ]);

    const { result } = renderHook(() =>
      useConversationReactions(
        makeParams({ messages, fetchReactionsForMessages, fetchReactionDeletions }),
      ),
    );

    await waitFor(() =>
      expect(result.current.reactionsByTarget.get(TARGET)?.byEmoji['❤️']).toEqual([PEER_PK]),
    );
    await waitFor(() => expect(fetchReactionDeletions).toHaveBeenCalled());
    // Pill survives — the forged deletion was ignored.
    expect(result.current.reactionsByTarget.get(TARGET)?.byEmoji['❤️']).toEqual([PEER_PK]);
  });
});
