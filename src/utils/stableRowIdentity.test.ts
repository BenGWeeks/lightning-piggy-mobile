import { reuseByIdShallow } from './stableRowIdentity';

type Row = { id: string; name: string; picture: string | null; lastActivityAt: number };

const row = (id: string, name = `name-${id}`, lastActivityAt = 1): Row => ({
  id,
  name,
  picture: null,
  lastActivityAt,
});

describe('reuseByIdShallow', () => {
  it('returns the previous ARRAY when nothing changed (rebuilt with new objects)', () => {
    const prev = [row('a'), row('b')];
    const next = [row('a'), row('b')]; // all-new object references, same values
    expect(reuseByIdShallow(prev, next)).toBe(prev);
  });

  it('reuses unchanged row OBJECTS when another row changed', () => {
    const prev = [row('a'), row('b')];
    const next = [row('a'), row('b', 'renamed')];
    const out = reuseByIdShallow(prev, next);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]); // unchanged → previous reference (React.memo bails)
    expect(out[1]).toBe(next[1]); // changed → new object
    expect(out[1].name).toBe('renamed');
  });

  it('does not return the previous array when order changed, but still reuses objects', () => {
    const prev = [row('a'), row('b')];
    const next = [row('b'), row('a')];
    const out = reuseByIdShallow(prev, next);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[1]);
    expect(out[1]).toBe(prev[0]);
  });

  it('handles added and removed rows', () => {
    const prev = [row('a'), row('b')];
    const next = [row('b'), row('c')];
    const out = reuseByIdShallow(prev, next);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(prev[1]); // still-present row keeps identity
    expect(out[1]).toBe(next[1]); // new row passes through
  });

  it('treats a changed field value as a changed row (Object.is compare)', () => {
    const prev = [row('a', 'x', 10)];
    const next = [row('a', 'x', 11)];
    const out = reuseByIdShallow(prev, next);
    expect(out[0]).toBe(next[0]);
  });

  it('treats differing key sets as changed', () => {
    const prev = [row('a')];
    const next = [{ ...row('a'), extra: true } as unknown as Row];
    const out = reuseByIdShallow(prev, next);
    expect(out[0]).toBe(next[0]);
  });

  it('returns next as-is for the identical array reference and handles empties', () => {
    const prev: Row[] = [];
    const next = [row('a')];
    expect(reuseByIdShallow(prev, next)[0]).toBe(next[0]);
    expect(reuseByIdShallow(next, next)).toBe(next);
    expect(reuseByIdShallow(next, [])).toEqual([]);
  });
});
