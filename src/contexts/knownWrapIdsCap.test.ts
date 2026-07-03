/**
 * Backpressure cap for the in-memory NIP-17 wrap-id dedup set (#804).
 *
 * `knownWrapIds` previously grew for the whole session — a busy account could
 * accumulate tens of thousands of ids (MBs of RAM). `capKnownWrapIds` bounds it
 * by evicting the oldest-inserted ids (Set preserves insertion order) once it
 * exceeds the cap, down to 75% so it isn't re-triggered on every add.
 */
import { capKnownWrapIds, KNOWN_WRAP_IDS_CAP } from './knownWrapIdsCap';

describe('capKnownWrapIds', () => {
  it('is a no-op while at or under the cap', () => {
    const set = new Set<string>(['a', 'b', 'c']);
    capKnownWrapIds(set);
    expect(set.size).toBe(3);
    expect([...set]).toEqual(['a', 'b', 'c']);
  });

  it('evicts down to 75% of the cap when exceeded', () => {
    const set = new Set<string>();
    for (let i = 0; i < KNOWN_WRAP_IDS_CAP + 500; i++) set.add(`id-${i}`);
    capKnownWrapIds(set);
    expect(set.size).toBe(Math.floor(KNOWN_WRAP_IDS_CAP * 0.75));
  });

  it('drops the OLDEST-inserted ids and keeps the newest', () => {
    const set = new Set<string>();
    for (let i = 0; i < KNOWN_WRAP_IDS_CAP + 1; i++) set.add(`id-${i}`);
    capKnownWrapIds(set);
    // Oldest (id-0) is gone; the most-recent id survives.
    expect(set.has('id-0')).toBe(false);
    expect(set.has(`id-${KNOWN_WRAP_IDS_CAP}`)).toBe(true);
  });

  it('caps exactly at the boundary (no eviction at size === cap)', () => {
    const set = new Set<string>();
    for (let i = 0; i < KNOWN_WRAP_IDS_CAP; i++) set.add(`id-${i}`);
    capKnownWrapIds(set);
    expect(set.size).toBe(KNOWN_WRAP_IDS_CAP);
  });
});
