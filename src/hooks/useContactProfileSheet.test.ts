/**
 * Unit tests for the Hunt contact-profile-sheet hook.
 *
 * These pin the three behaviours the Hunt detail screen had drifted from
 * vs. ConversationScreen (#751 follow-up): the sheet must surface a real
 * banner + Lightning address (re-resolved from the *verified* profile, not
 * the slim row cache), gate `canZap` on that address, and wire
 * "View full profile" to the ContactProfile route.
 *
 *   1. Seed-then-patch: openProfileSheet paints the row's known fields
 *      immediately, then patches in the verified banner + lud16.
 *   2. canZap follows the resolved Lightning address.
 *   3. onZap is undefined without an address, defined with one, and routes
 *      through the host's openZapForContact (the in-app SendSheet flow).
 *   4. onViewFullProfile + onMessage navigate to the right routes.
 *   5. A stale fetch (sheet closed / different contact opened) doesn't clobber.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useContactProfileSheet } from './useContactProfileSheet';
import * as nostrService from '../services/nostrService';
import type { NostrProfile } from '../types/nostr';

jest.mock('../services/nostrService', () => ({
  __esModule: true,
  fetchProfile: jest.fn(),
}));

jest.mock('../contexts/NostrContext', () => ({
  __esModule: true,
  useNostr: () => ({ relays: [{ url: 'wss://relay.example', read: true, write: true }] }),
}));

const mockedFetchProfile = nostrService.fetchProfile as jest.MockedFunction<
  typeof nostrService.fetchProfile
>;

const PK = 'a'.repeat(64);

const makeNav = () => ({ navigate: jest.fn() }) as never;

const profileWith = (over: Partial<NostrProfile>): NostrProfile =>
  ({
    pubkey: PK,
    npub: 'npub1xxx',
    name: 'hider',
    displayName: 'The Hider',
    picture: 'https://img/avatar.png',
    banner: 'https://img/banner.png',
    nip05: null,
    lud16: 'hider@example.com',
    about: null,
    ...over,
  }) as NostrProfile;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useContactProfileSheet', () => {
  it('seeds from the row immediately, then patches in the verified banner + lud16', async () => {
    mockedFetchProfile.mockResolvedValue(profileWith({}));
    const { result } = renderHook(() => useContactProfileSheet(makeNav(), jest.fn()));

    // Row knows name + avatar but no banner; the slim cache nulled lud16.
    act(() => {
      result.current.openProfileSheet(PK, 'The Hider', 'https://img/avatar.png', null);
    });

    // Instant paint — no banner / address yet, sheet already visible.
    expect(result.current.profileSheet).not.toBeNull();
    expect(result.current.contact?.banner).toBeNull();
    expect(result.current.canZap).toBe(false);

    // Verified fetch lands → banner + address fill in, zap unlocks.
    await waitFor(() => expect(result.current.contact?.banner).toBe('https://img/banner.png'));
    expect(result.current.contact?.lightningAddress).toBe('hider@example.com');
    expect(result.current.canZap).toBe(true);
  });

  it('keeps onZap undefined when the contact has no Lightning address', async () => {
    mockedFetchProfile.mockResolvedValue(profileWith({ lud16: null, banner: null }));
    const { result } = renderHook(() => useContactProfileSheet(makeNav(), jest.fn()));

    act(() => {
      result.current.openProfileSheet(PK, 'No Zap', null, null);
    });
    await waitFor(() => expect(mockedFetchProfile).toHaveBeenCalled());

    expect(result.current.canZap).toBe(false);
    expect(result.current.onZap).toBeUndefined();
  });

  it('routes onZap through the host openZapForContact and closes the sheet', async () => {
    mockedFetchProfile.mockResolvedValue(profileWith({}));
    const onRequestZap = jest.fn();
    const { result } = renderHook(() => useContactProfileSheet(makeNav(), onRequestZap));

    act(() => {
      result.current.openProfileSheet(PK, 'The Hider', null, 'hider@example.com');
    });
    await waitFor(() => expect(result.current.onZap).toBeDefined());

    act(() => result.current.onZap?.());

    expect(onRequestZap).toHaveBeenCalledWith({
      pubkey: PK,
      name: 'The Hider',
      lud16: 'hider@example.com',
    });
    expect(result.current.profileSheet).toBeNull();
  });

  it('onViewFullProfile navigates to ContactProfile with the resolved contact', async () => {
    mockedFetchProfile.mockResolvedValue(profileWith({}));
    const nav = makeNav();
    const { result } = renderHook(() => useContactProfileSheet(nav, jest.fn()));

    act(() => {
      result.current.openProfileSheet(PK, 'The Hider', null, 'hider@example.com');
    });
    await waitFor(() => expect(result.current.contact?.banner).toBe('https://img/banner.png'));

    act(() => result.current.onViewFullProfile());

    expect((nav as unknown as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith(
      'ContactProfile',
      expect.objectContaining({ contact: expect.objectContaining({ pubkey: PK }) }),
    );
    expect(result.current.profileSheet).toBeNull();
  });

  it('onMessage navigates to a Conversation with the contact', async () => {
    mockedFetchProfile.mockResolvedValue(profileWith({}));
    const nav = makeNav();
    const { result } = renderHook(() => useContactProfileSheet(nav, jest.fn()));

    act(() => {
      result.current.openProfileSheet(PK, 'The Hider', null, 'hider@example.com');
    });
    await waitFor(() => expect(result.current.onMessage).toBeDefined());

    act(() => result.current.onMessage?.());

    expect((nav as unknown as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith(
      'Conversation',
      expect.objectContaining({ pubkey: PK }),
    );
  });

  it('does not clobber the sheet when a stale fetch resolves after close', async () => {
    let resolveFetch!: (p: NostrProfile | null) => void;
    mockedFetchProfile.mockReturnValue(
      new Promise<NostrProfile | null>((res) => {
        resolveFetch = res;
      }),
    );
    const { result } = renderHook(() => useContactProfileSheet(makeNav(), jest.fn()));

    act(() => {
      result.current.openProfileSheet(PK, 'The Hider', null, null);
    });
    // Close before the fetch lands.
    act(() => result.current.closeProfileSheet());
    expect(result.current.profileSheet).toBeNull();

    // Stale fetch resolves — must not re-open the sheet.
    await act(async () => {
      resolveFetch(profileWith({}));
    });
    expect(result.current.profileSheet).toBeNull();
  });
});
