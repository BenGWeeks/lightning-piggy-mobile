import {
  generateBolt,
  boltToSvgPath,
  branchCount,
  type Point,
  type BoltBranch,
} from './lightningBolt';

// A tiny seeded PRNG (mulberry32) so every test is fully deterministic and we
// never depend on Math.random(). Returns values in [0,1).
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START: Point = { x: 0, y: 0 };
const END: Point = { x: 0, y: 400 };

describe('generateBolt', () => {
  it('returns at least the trunk branch (depth 0) first', () => {
    const branches = generateBolt(START, END, seededRng(1));
    expect(branches.length).toBeGreaterThanOrEqual(1);
    expect(branches[0].depth).toBe(0);
  });

  it('keeps the trunk anchored to the start and end points', () => {
    const branches = generateBolt(START, END, seededRng(7));
    const trunk = branches[0].points;
    expect(trunk[0]).toEqual(START);
    expect(trunk[trunk.length - 1]).toEqual(END);
  });

  it('produces a jagged polyline with multiple vertices (subdivision)', () => {
    // detail=6 → 2^6 segments → 65 trunk vertices.
    const branches = generateBolt(START, END, seededRng(3), { detail: 6 });
    expect(branches[0].points.length).toBe(65);
  });

  it('detail=0 yields a straight, two-point trunk (no subdivision)', () => {
    const branches = generateBolt(START, END, seededRng(3), { detail: 0 });
    expect(branches[0].points).toEqual([START, END]);
  });

  it('is deterministic for a given seed — same rng → identical geometry', () => {
    const a = generateBolt(START, END, seededRng(42));
    const b = generateBolt(START, END, seededRng(42));
    expect(a).toEqual(b);
  });

  it('different seeds produce different geometry', () => {
    const a = generateBolt(START, END, seededRng(1));
    const b = generateBolt(START, END, seededRng(2));
    expect(a).not.toEqual(b);
  });

  it('spawns forks when forkProbability is high', () => {
    const branches = generateBolt(START, END, seededRng(9), { forkProbability: 1 });
    expect(branches.length).toBeGreaterThan(1);
    // Every non-trunk branch is a fork at depth >= 1.
    branches.slice(1).forEach((b: BoltBranch) => expect(b.depth).toBeGreaterThanOrEqual(1));
  });

  it('spawns NO forks when forkProbability is 0', () => {
    const branches = generateBolt(START, END, seededRng(9), { forkProbability: 0 });
    expect(branchCount(branches)).toBe(1);
  });

  it('respects maxForkDepth — no branch deeper than the cap', () => {
    const branches = generateBolt(START, END, seededRng(11), {
      forkProbability: 1,
      maxForkDepth: 2,
    });
    const deepest = Math.max(...branches.map((b) => b.depth));
    expect(deepest).toBeLessThanOrEqual(2);
  });

  it('displaces midpoints off the straight line (non-zero amplitude)', () => {
    const branches = generateBolt(START, END, seededRng(5), { displacement: 0.3, detail: 5 });
    const trunk = branches[0].points;
    // A perfectly straight vertical bolt would have x===0 everywhere; some
    // vertex must be pushed sideways.
    const maxX = Math.max(...trunk.map((p) => Math.abs(p.x)));
    expect(maxX).toBeGreaterThan(0);
  });
});

describe('boltToSvgPath', () => {
  it('serialises a polyline to an SVG move/line path', () => {
    const d = boltToSvgPath([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 5, y: 40 },
    ]);
    expect(d).toBe('M 0 0 L 10 20 L 5 40');
  });

  it('rounds coordinates to two decimals to keep the string compact', () => {
    const d = boltToSvgPath([
      { x: 0.123456, y: 1.987654 },
      { x: 2.5, y: 3.5 },
    ]);
    expect(d).toBe('M 0.12 1.99 L 2.5 3.5');
  });

  it('returns empty string for fewer than two points', () => {
    expect(boltToSvgPath([])).toBe('');
    expect(boltToSvgPath([{ x: 1, y: 2 }])).toBe('');
  });

  it('round-trips a generated trunk into a valid path string', () => {
    const branches = generateBolt(START, END, seededRng(4));
    const d = boltToSvgPath(branches[0].points);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' L ');
  });
});
