import AsyncStorage from '@react-native-async-storage/async-storage';
import { lastClaimFor, loadClaimHistory, recordClaim } from './claimHistoryService';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (k: string) => store[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    __reset: () => {
      store = {};
    },
  };
});

const reset = () => (AsyncStorage as unknown as { __reset: () => void }).__reset();

describe('claimHistoryService', () => {
  beforeEach(reset);

  it('returns empty on cold install', async () => {
    expect(await loadClaimHistory()).toEqual([]);
  });

  it('records a claim with auto-timestamp and reads it back', async () => {
    const before = Math.floor(Date.now() / 1000);
    await recordClaim({ lnurl: 'lnurl1xyz', sats: 21 });
    const list = await loadClaimHistory();
    expect(list).toHaveLength(1);
    expect(list[0].lnurl).toBe('lnurl1xyz');
    expect(list[0].sats).toBe(21);
    expect(list[0].claimedAt).toBeGreaterThanOrEqual(before);
  });

  it('normalises LNURL to lowercase + trim on read & write', async () => {
    await recordClaim({ lnurl: '  LNURL1XYZ  ', sats: 21 });
    const hit = await lastClaimFor('lnurl1xyz');
    expect(hit?.sats).toBe(21);
  });

  it('lastClaimFor returns the most-recent entry', async () => {
    await recordClaim({ lnurl: 'lnurl1abc', sats: 21, claimedAt: 100 });
    await recordClaim({ lnurl: 'lnurl1abc', sats: 21, claimedAt: 200 });
    await recordClaim({ lnurl: 'lnurl1xyz', sats: 100, claimedAt: 150 });
    const hit = await lastClaimFor('lnurl1abc');
    expect(hit?.claimedAt).toBe(200);
  });

  it('returns null from lastClaimFor when no match', async () => {
    await recordClaim({ lnurl: 'lnurl1abc', sats: 21 });
    expect(await lastClaimFor('lnurl1nope')).toBeNull();
  });

  it('preserves optional piggyId', async () => {
    await recordClaim({ lnurl: 'lnurl1xyz', sats: 21, piggyId: 'piggy_xyz' });
    const hit = await lastClaimFor('lnurl1xyz');
    expect(hit?.piggyId).toBe('piggy_xyz');
  });

  it('caps at MAX_ENTRIES (oldest rotated out)', async () => {
    // Insert MAX_ENTRIES + 5 to verify rotation. We don't import the
    // constant — testing its observable behaviour.
    for (let i = 0; i < 510; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await recordClaim({ lnurl: `lnurl1${i}`, sats: 21, claimedAt: i });
    }
    const list = await loadClaimHistory();
    expect(list.length).toBe(500);
    // Newest entry is at index 0 (we prepend); oldest survivor's claimedAt
    // should be 510 - 500 = 10.
    expect(list[0].claimedAt).toBe(509);
    expect(list[list.length - 1].claimedAt).toBe(10);
  });
});
