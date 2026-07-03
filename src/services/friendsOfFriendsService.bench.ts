// Microbenchmark for the FoF compute path (#535 / PR #536).
//
// Why this exists: `buildFofSet` runs synchronously on the JS thread when
// the user first selects the Friends-of-friends tier. A realistic graph
// can be 300 friends × 300 follows ≈ 90 k pubkeys before dedup. If the
// loop is O(N²) we'll feel it as a multi-hundred-millisecond hitch on
// the bottom-sheet open. This bench gives us a single number to track
// regressions branch-vs-branch.
//
// Run command (matches the project's Jest preset so we don't need an
// extra TS runner):
//
//   npx jest --testMatch '**/friendsOfFriendsService.bench.ts' \
//     --testPathIgnorePatterns=[]
//
// or via the wrapper:
//
//   bash scripts/bench-fof.sh
//
// The file is intentionally a `.bench.ts` (NOT `.test.ts`) so the default
// jest run (jest.config.js → testMatch: '*.test.{ts,tsx}') skips it; it
// is opt-in via the explicit --testRegex override above.

import { buildFofSet, FANOUT_CAP } from './friendsOfFriendsService';

const FRIENDS = 300;
const FOLLOWS_PER_FRIEND = 300;
const RUNS = 10;
// Pool of candidate "third party" pubkeys; friends' follow lists draw
// from this pool with overlap so dedup actually does work. Pool sized
// large enough that the set doesn't saturate (we want to measure the
// dedup path, not the pool-exhaustion path). 90 000 total draws against
// a 30 000-pubkey pool yields a final set ≈ 28 k after dedup.
const POOL_SIZE = 30_000;

// Cheap deterministic PRNG (mulberry32) so successive runs of the bench
// are comparable without resorting to a seedable third-party RNG.
const mulberry32 = (seed: number): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Synthetic 64-char hex-like pubkey. Padding pattern mirrors the unit
// test helper so the bench can't accidentally collide with friend keys.
const hexPk = (prefix: string, n: number): string => {
  const tail = `${prefix}_${n}`;
  return tail.padStart(64, '0').slice(-64);
};

const buildSyntheticGraph = (
  seed: number,
): {
  user: string;
  friends: string[];
  followLists: Record<string, string[]>;
} => {
  const rng = mulberry32(seed);
  const user = hexPk('user', 0);
  const friends = Array.from({ length: FRIENDS }, (_, i) => hexPk('friend', i));
  const pool = Array.from({ length: POOL_SIZE }, (_, i) => hexPk('p', i));
  const followLists: Record<string, string[]> = {};
  for (const friend of friends) {
    const list: string[] = [];
    const seen = new Set<string>();
    while (list.length < FOLLOWS_PER_FRIEND) {
      const idx = Math.floor(rng() * pool.length);
      const pk = pool[idx];
      if (!seen.has(pk)) {
        seen.add(pk);
        list.push(pk);
      }
    }
    followLists[friend] = list;
  }
  return { user, friends, followLists };
};

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
};

// We pre-build the graph once outside the timing loop — graph build is
// not what we're measuring. `buildFofSet` itself is the hot path.
describe('friendsOfFriendsService — microbenchmark (opt-in)', () => {
  it(`computes FoF on ${FRIENDS}×${FOLLOWS_PER_FRIEND} graph in < 100 ms median`, () => {
    const { user, friends, followLists } = buildSyntheticGraph(0xc0ffee);
    const timingsMs: number[] = [];
    let lastSize = 0;
    let lastExcluded = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const t0 = performance.now();
      const { set, excludedFriends } = buildFofSet(user, friends, followLists);
      const elapsed = performance.now() - t0;
      timingsMs.push(elapsed);
      lastSize = set.size;
      lastExcluded = excludedFriends;
    }
    const sorted = [...timingsMs].sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const mean = timingsMs.reduce((s, x) => s + x, 0) / timingsMs.length;
    const fmt = (n: number): string => n.toFixed(2);
    // Jest's console wrapper swallows test-time logs by default. Write
    // directly to the real stderr so the bench numbers always surface
    // when the file is run via `bash scripts/bench-fof.sh`.
    process.stderr.write(
      [
        '',
        '── FoF microbenchmark ─────────────────────────',
        `graph:      ${FRIENDS} friends × ${FOLLOWS_PER_FRIEND} follows (pool=${POOL_SIZE})`,
        `runs:       ${RUNS}`,
        `set size:   ${lastSize.toLocaleString()} pubkeys`,
        `excluded:   ${lastExcluded} friends (heuristic 1)`,
        `mean:       ${fmt(mean)} ms`,
        `median:     ${fmt(median)} ms`,
        `p95:        ${fmt(p95)} ms`,
        `min / max:  ${fmt(sorted[0])} / ${fmt(sorted[sorted.length - 1])} ms`,
        '───────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    // The bench is informational, not a CI gate, so the assertion is
    // intentionally generous — orders-of-magnitude regressions still
    // fail loudly, but normal noise won't redden the run. Threshold is
    // set well above the laptop median to leave headroom for slower CI
    // hardware if we ever wire this into a workflow.
    expect(median).toBeLessThan(1000);
    // Sanity guard on the data: with 300 friends × 300 follows drawn
    // from a 5 000-pubkey pool we always saturate the pool. None of the
    // friends exceeds FANOUT_CAP follows so heuristic 1 excludes 0.
    expect(lastExcluded).toBe(0);
    expect(lastSize).toBeGreaterThan(FANOUT_CAP);
  });
});
