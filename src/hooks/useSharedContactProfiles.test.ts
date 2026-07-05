/**
 * Unit tests for the shared-contact-profile resolver hook (#988 follow-up).
 *
 * The hook was extracted from ConversationScreen (#431) to "give the fetch its
 * own testable seam"; these tests pin the stateful behaviour that seam exists
 * to protect:
 *
 *   1. It fetches the kind-0 for a `nostr:` contact shared by the other party
 *      and exposes it keyed by pubkey.
 *   2. It merges the nprofile's relay hints with DEFAULT_RELAYS (so someone
 *      publishing on niche relays is still found) and de-dups the union.
 *   3. It de-dups scheduling across `messages` updates — the same pubkey is
 *      never re-fetched when a later render re-lists it.
 *   4. Empty / missing refs do nothing; an empty lookup surfaces as `null`; a
 *      failed fetch is swallowed to `null` rather than thrown.
 *   5. Distinct pubkeys in one batch are fetched in parallel and all merged.
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { useSharedContactProfiles } from './useSharedContactProfiles';
import * as nostrService from '../services/nostrService';
import * as messageContent from '../utils/messageContent';
import type { ConversationMessageInput } from '../utils/conversationItems';
import type { NostrProfile } from '../types/nostr';

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];

jest.mock('../services/nostrService', () => ({
  __esModule: true,
  DEFAULT_RELAYS: ['wss://relay.damus.io', 'wss://nos.lol'],
  fetchProfile: jest.fn(),
}));

jest.mock('../utils/messageContent', () => ({
  __esModule: true,
  extractSharedContact: jest.fn(),
}));

const mockedFetchProfile = nostrService.fetchProfile as jest.MockedFunction<
  typeof nostrService.fetchProfile
>;
const mockedExtract = messageContent.extractSharedContact as jest.MockedFunction<
  typeof messageContent.extractSharedContact
>;

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

/**
 * A `messages` update where each entry's `text` is a `share:<pk>|<relays>`
 * token the mocked `extractSharedContact` decodes back into a ref. Plain text
 * (no `share:` prefix) decodes to `null`, standing in for a normal message.
 */
const msg = (id: string, text: string): ConversationMessageInput => ({
  id,
  fromMe: false,
  text,
  createdAt: 1,
});
const share = (pubkey: string, relays: string[] = []) => `share:${pubkey}|${relays.join(',')}`;

const profile = (pubkey: string): NostrProfile =>
  ({ pubkey, npub: `npub_${pubkey}`, name: pubkey.slice(0, 4) }) as NostrProfile;

beforeEach(() => {
  jest.clearAllMocks();
  mockedExtract.mockImplementation((text: string) => {
    if (!text?.startsWith('share:')) return null;
    const [pubkey, relaysCsv] = text.slice('share:'.length).split('|');
    return { pubkey, relays: relaysCsv ? relaysCsv.split(',') : [] };
  });
});

describe('useSharedContactProfiles', () => {
  it('resolves the shared contact profile keyed by pubkey', async () => {
    mockedFetchProfile.mockResolvedValue(profile(PK_A));

    const { result } = renderHook(
      (props: { messages: ConversationMessageInput[] }) => useSharedContactProfiles(props.messages),
      {
        initialProps: { messages: [msg('1', share(PK_A))] },
      },
    );

    // Nothing resolved synchronously.
    expect(result.current).toEqual({});

    await waitFor(() => expect(result.current[PK_A]).toEqual(profile(PK_A)));
    expect(mockedFetchProfile).toHaveBeenCalledTimes(1);
  });

  it('merges nprofile relay hints with DEFAULT_RELAYS (de-duped)', async () => {
    mockedFetchProfile.mockResolvedValue(profile(PK_A));
    // One hint is novel, one duplicates a default — the union must de-dup it.
    const hints = ['wss://niche.example', 'wss://relay.damus.io'];

    renderHook(() => useSharedContactProfiles([msg('1', share(PK_A, hints))]));

    await waitFor(() => expect(mockedFetchProfile).toHaveBeenCalled());
    const [, passedRelays] = mockedFetchProfile.mock.calls[0];
    expect(passedRelays).toEqual([...DEFAULT_RELAYS, 'wss://niche.example']);
    // No duplicate of the shared default relay.
    expect(passedRelays).toHaveLength(new Set(passedRelays).size);
  });

  it('does not re-fetch a pubkey already scheduled on a later messages update', async () => {
    mockedFetchProfile.mockResolvedValue(profile(PK_A));

    const { result, rerender } = renderHook(
      (messages: ConversationMessageInput[]) => useSharedContactProfiles(messages),
      { initialProps: [msg('1', share(PK_A))] },
    );
    await waitFor(() => expect(result.current[PK_A]).toBeDefined());
    expect(mockedFetchProfile).toHaveBeenCalledTimes(1);

    // A fresh messages array (new object, new id) still lists the same pubkey.
    rerender([msg('1', share(PK_A)), msg('2', share(PK_A))]);
    // Give any (unwanted) async fetch a chance to fire.
    await Promise.resolve();
    expect(mockedFetchProfile).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no message carries a shared contact', async () => {
    const { result } = renderHook(() =>
      useSharedContactProfiles([msg('1', 'just a normal message'), msg('2', 'hi')]),
    );

    await Promise.resolve();
    expect(mockedFetchProfile).not.toHaveBeenCalled();
    expect(result.current).toEqual({});
  });

  it('records null when the lookup comes back empty', async () => {
    mockedFetchProfile.mockResolvedValue(null);

    const { result } = renderHook(() => useSharedContactProfiles([msg('1', share(PK_A))]));

    await waitFor(() => expect(PK_A in result.current).toBe(true));
    expect(result.current[PK_A]).toBeNull();
  });

  it('swallows a failed fetch to null rather than throwing', async () => {
    mockedFetchProfile.mockRejectedValue(new Error('relay down'));

    const { result } = renderHook(() => useSharedContactProfiles([msg('1', share(PK_A))]));

    await waitFor(() => expect(PK_A in result.current).toBe(true));
    expect(result.current[PK_A]).toBeNull();
  });

  it('fetches distinct shared pubkeys in one batch and merges them all', async () => {
    mockedFetchProfile.mockImplementation(async (pk: string) => profile(pk));

    const { result } = renderHook(() =>
      useSharedContactProfiles([msg('1', share(PK_A)), msg('2', share(PK_B))]),
    );

    await waitFor(() => {
      expect(result.current[PK_A]).toEqual(profile(PK_A));
      expect(result.current[PK_B]).toEqual(profile(PK_B));
    });
    expect(mockedFetchProfile).toHaveBeenCalledTimes(2);
  });
});
