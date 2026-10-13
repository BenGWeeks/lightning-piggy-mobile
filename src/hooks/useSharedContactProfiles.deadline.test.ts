import { act, renderHook } from '@testing-library/react-native';
import { useSharedContactProfiles } from './useSharedContactProfiles';
import { fetchProfilesBatch } from '../services/nostrProfileBatch';
import * as cache from '../services/zapSenderProfileStorage';
import { extractSharedContact } from '../utils/messageContent';

jest.mock('../services/nostrProfileBatch', () => ({ fetchProfilesBatch: jest.fn() }));
jest.mock('../services/zapSenderProfileStorage', () => ({ getMany: jest.fn() }));
jest.mock('../utils/messageContent', () => ({ extractSharedContact: jest.fn() }));

it('keeps a second-batch profile received before expiry while another author is missing', async () => {
  jest.useFakeTimers();
  try {
    const pubkeys = Array.from({ length: 52 }, (_, i) => i.toString(16).padStart(64, '0'));
    jest.mocked(extractSharedContact).mockImplementation((text) => ({ pubkey: text, relays: [] }));
    jest.mocked(cache.getMany).mockResolvedValue(new Map());
    let ingestLate!: Parameters<typeof fetchProfilesBatch>[3];
    jest
      .mocked(fetchProfilesBatch)
      .mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 8000)))
      .mockImplementationOnce((_pubkeys, _relays, _timeout, ingest) => {
        ingestLate = ingest;
        ingest({
          pubkey: pubkeys[50],
          content: JSON.stringify({ name: 'Found Piggy', lud16: 'piggy@example.com' }),
          created_at: 1,
        });
        return new Promise(() => {});
      });
    const { result, unmount } = renderHook(() =>
      useSharedContactProfiles(pubkeys.map((text) => ({ text }))),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(8000);
    });
    expect(fetchProfilesBatch).toHaveBeenCalledTimes(2);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current[pubkeys[50]]).toMatchObject({
      pubkey: pubkeys[50],
      name: 'Found Piggy',
      lud16: 'piggy@example.com',
    });
    expect(result.current[pubkeys[51]]).toBeNull();
    await act(async () => {
      ingestLate({ pubkey: pubkeys[51], content: '{"name":"Late Piggy"}', created_at: 1 });
      await jest.advanceTimersByTimeAsync(10000);
    });
    expect(result.current[pubkeys[50]]?.name).toBe('Found Piggy');
    expect(result.current[pubkeys[51]]).toBeNull();
    unmount();
  } finally {
    jest.useRealTimers();
  }
});
