import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSharedContactProfiles } from './useSharedContactProfiles';
import { resolveSharedContactProfiles } from '../services/sharedContactProfiles';
import { extractSharedContact } from '../utils/messageContent';
import type { NostrContact, NostrProfile } from '../types/nostr';

jest.mock('../services/sharedContactProfiles', () => ({
  SHARED_PROFILE_BATCH_SIZE: 50,
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
