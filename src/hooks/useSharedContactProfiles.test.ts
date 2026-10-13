import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSharedContactProfiles } from './useSharedContactProfiles';
import { resolveSharedContactProfiles } from '../services/sharedContactProfiles';
import { extractSharedContact } from '../utils/messageContent';
import type { NostrContact, NostrProfile } from '../types/nostr';
import { slimDisplayProfile } from '../utils/profileSanitize';

jest.mock('../services/sharedContactProfiles', () => ({
  SHARED_PROFILE_BATCH_SIZE: 50,
  SHARED_PROFILE_TIMEOUT_MS: 10000,
  resolveSharedContactProfiles: jest.fn(),
}));
jest.mock('../utils/messageContent', () => ({ extractSharedContact: jest.fn() }));
const resolveProfiles = jest.mocked(resolveSharedContactProfiles);
const extract = jest.mocked(extractSharedContact);
const PK = 'a'.repeat(64);
const profile = {
  pubkey: PK,
  name: 'Little Piggy',
  picture: 'https://example.com/piggy.png',
} as NostrProfile;
const message = { id: 'local-1', text: 'contact', fromMe: true };

beforeEach(() => {
  jest.resetAllMocks();
  extract.mockImplementation((text) =>
    text === 'contact' ? { pubkey: PK, relays: ['wss://hint.example'] } : null,
  );
  resolveProfiles.mockResolvedValue({ [PK]: profile });
});

it.each(['nip17', 'marmot'])(
  'a %s sender resolves after optimistic message reconciliation',
  async (protocol) => {
    let finish!: (profiles: Record<string, NostrProfile | null>) => void;
    resolveProfiles.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      (messages: (typeof message & { protocol: string })[]) => useSharedContactProfiles(messages),
      {
        initialProps: [{ ...message, protocol }],
      },
    );
    expect(result.current[PK]).toBeUndefined();
    rerender([{ ...message, protocol, id: 'published-id' }]);
    await act(async () => finish({ [PK]: profile }));
    expect(result.current[PK]).toEqual(profile);
    expect(resolveProfiles).toHaveBeenCalledTimes(1);
    expect(resolveProfiles).toHaveBeenCalledWith(
      [{ pubkey: PK, relays: ['wss://hint.example'] }],
      expect.any(Function),
    );
  },
);

it('shows a display-only friend immediately and refreshes its verified Lightning address', async () => {
  const verified = { ...profile, lud16: 'piggy@example.com' };
  const displayOnly = slimDisplayProfile(verified);
  let finish!: (profiles: Record<string, NostrProfile | null>) => void;
  resolveProfiles.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const contacts = [{ pubkey: PK, profile: displayOnly }] as NostrContact[];
  const { result } = renderHook(() => useSharedContactProfiles([message], contacts));
  expect(result.current[PK]).toEqual(displayOnly);
  expect(resolveProfiles).toHaveBeenCalledWith(
    [{ pubkey: PK, relays: ['wss://hint.example'] }],
    expect.any(Function),
  );
  await act(async () => finish({ [PK]: verified }));
  expect(result.current[PK]).toEqual(verified);
});

it('preserves a verified profile when display-only friends hydrate later', async () => {
  const verified = { ...profile, lud16: 'piggy@example.com' };
  resolveProfiles.mockResolvedValue({ [PK]: verified });
  const { result, rerender } = renderHook(
    (contacts: NostrContact[]) => useSharedContactProfiles([message], contacts),
    { initialProps: [] },
  );
  await waitFor(() => expect(result.current[PK]).toEqual(verified));
  rerender([{ pubkey: PK, profile: slimDisplayProfile(verified) }] as NostrContact[]);
  expect(result.current[PK]).toEqual(verified);
  expect(resolveProfiles).toHaveBeenCalledTimes(1);
});

it('a completed miss is null rather than indefinitely pending', async () => {
  resolveProfiles.mockResolvedValue({ [PK]: null });
  const { result } = renderHook(() => useSharedContactProfiles([message]));
  await waitFor(() => expect(result.current[PK]).toBeNull());
});

it('a friend cache hydration replaces a prior miss', async () => {
  resolveProfiles.mockResolvedValue({ [PK]: null });
  const { result, rerender } = renderHook(
    (contacts: NostrContact[]) => useSharedContactProfiles([message], contacts),
    { initialProps: [] },
  );
  await waitFor(() => expect(result.current[PK]).toBeNull());
  rerender([{ pubkey: PK, profile }] as NostrContact[]);
  expect(result.current[PK]).toEqual(profile);
});

it('does nothing for ordinary messages', () => {
  const { result } = renderHook(() => useSharedContactProfiles([{ text: 'hello' }]));
  expect(result.current).toEqual({});
  expect(resolveProfiles).not.toHaveBeenCalled();
});

it.each([51, 151])(
  'all %i scheduled cards fall back at ten seconds, including queued batches',
  async (count) => {
    jest.useFakeTimers();
    try {
      const pubkeys = Array.from({ length: count }, (_, i) => i.toString(16).padStart(64, '0'));
      extract.mockImplementation((text) => ({ pubkey: text, relays: [] }));
      let finishLate!: (profiles: Record<string, NostrProfile | null>) => void;
      resolveProfiles
        .mockImplementationOnce(
          (refs) =>
            new Promise((resolve) => {
              setTimeout(
                () => resolve(Object.fromEntries(refs.map(({ pubkey }) => [pubkey, null]))),
                8000,
              );
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishLate = resolve;
            }),
        );
      const { result, unmount } = renderHook(() =>
        useSharedContactProfiles(pubkeys.map((text) => ({ text }))),
      );
      await act(async () => {
        await jest.advanceTimersByTimeAsync(8000);
      });
      expect(resolveProfiles).toHaveBeenCalledTimes(2);
      expect(result.current[pubkeys[50]]).toBeUndefined();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1999);
      });
      expect(result.current[pubkeys[count - 1]]).toBeUndefined();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      for (const pubkey of pubkeys) expect(result.current[pubkey]).toBeNull();
      await act(async () => finishLate({ [pubkeys[50]]: profile }));
      expect(result.current[pubkeys[50]]).toBeNull();
      expect(resolveProfiles).toHaveBeenCalledTimes(2);
      unmount();
    } finally {
      jest.useRealTimers();
    }
  },
);
