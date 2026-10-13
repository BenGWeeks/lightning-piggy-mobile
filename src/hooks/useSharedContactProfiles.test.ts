import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSharedContactProfiles } from './useSharedContactProfiles';
import { resolveSharedContactProfiles } from '../services/sharedContactProfiles';
import { extractSharedContact } from '../utils/messageContent';
import type { NostrContact, NostrProfile } from '../types/nostr';

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
    expect(resolveProfiles).toHaveBeenCalledWith([{ pubkey: PK, relays: ['wss://hint.example'] }]);
  },
);

it('uses a known friend profile immediately without fetching', () => {
  const contacts = [{ pubkey: PK, profile }] as NostrContact[];
  const { result } = renderHook(() => useSharedContactProfiles([message], contacts));
  expect(result.current[PK]).toEqual(profile);
  expect(resolveProfiles).not.toHaveBeenCalled();
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
