const mockSelectKnown = jest.fn();
const mockUpsert = jest.fn();
jest.mock('./dmDb', () => ({
  selectKnownEventIds: (...args: unknown[]) => mockSelectKnown(...args),
  upsertDmMessages: (...args: unknown[]) => mockUpsert(...args),
}));

import { ingestWraps, type IngestableWrap } from './dmIngest';
import type { DmMessageRow } from './dmDb';

const wrap = (id: string): IngestableWrap => ({ id });
const rowFor = (id: string): DmMessageRow => ({
  eventId: id,
  conversation: 'conv',
  createdAt: 1,
  sender: 's',
  content: 'c',
  fromMe: false,
  wireKind: 14,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectKnown.mockResolvedValue(new Set<string>());
  mockUpsert.mockResolvedValue(undefined);
});

describe('dmIngest.ingestWraps', () => {
  it('no-ops on empty input (no DB calls)', async () => {
    const decrypt = jest.fn();
    const res = await ingestWraps([], decrypt);
    expect(res).toEqual({ ingested: 0, alreadyKnown: 0, undecryptable: 0 });
    expect(mockSelectKnown).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('decrypts only wraps not already stored (the decrypt-once gate)', async () => {
    mockSelectKnown.mockResolvedValue(new Set(['a', 'c'])); // a + c already stored
    const decrypt = jest.fn(async (w: IngestableWrap) => rowFor(w.id));
    const res = await ingestWraps([wrap('a'), wrap('b'), wrap('c'), wrap('d')], decrypt);
    // only b + d get decrypted
    expect(decrypt.mock.calls.map((c) => c[0].id)).toEqual(['b', 'd']);
    expect(res).toEqual({ ingested: 2, alreadyKnown: 2, undecryptable: 0 });
  });

  it('upserts exactly the freshly decrypted rows', async () => {
    const decrypt = jest.fn(async (w: IngestableWrap) => rowFor(w.id));
    await ingestWraps([wrap('x'), wrap('y')], decrypt);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0].map((r: DmMessageRow) => r.eventId)).toEqual(['x', 'y']);
  });

  it('counts undecryptable wraps (decryptor returns null) and does not store them', async () => {
    const decrypt = jest.fn(async (w: IngestableWrap) => (w.id === 'bad' ? null : rowFor(w.id)));
    const res = await ingestWraps([wrap('ok'), wrap('bad')], decrypt);
    expect(res).toEqual({ ingested: 1, alreadyKnown: 0, undecryptable: 1 });
    expect(mockUpsert.mock.calls[0][0].map((r: DmMessageRow) => r.eventId)).toEqual(['ok']);
  });

  it('treats a throwing decryptor as undecryptable and keeps going (no whole-sync abort)', async () => {
    const decrypt = jest.fn(async (w: IngestableWrap) => {
      if (w.id === 'boom') throw new Error('unwrap failed');
      return rowFor(w.id);
    });
    const res = await ingestWraps([wrap('ok1'), wrap('boom'), wrap('ok2')], decrypt);
    expect(decrypt).toHaveBeenCalledTimes(3); // didn't abort after the throw
    expect(res).toEqual({ ingested: 2, alreadyKnown: 0, undecryptable: 1 });
    expect(mockUpsert.mock.calls[0][0].map((r: DmMessageRow) => r.eventId)).toEqual(['ok1', 'ok2']);
  });

  it('does not call upsert when nothing is fresh (all already known)', async () => {
    mockSelectKnown.mockResolvedValue(new Set(['a', 'b']));
    const decrypt = jest.fn();
    const res = await ingestWraps([wrap('a'), wrap('b')], decrypt);
    expect(decrypt).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(res.alreadyKnown).toBe(2);
  });

  it('yields to the event loop every N fresh decrypts and reports progress', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => wrap(`w${i}`));
    const decrypt = jest.fn(async (w: IngestableWrap) => rowFor(w.id));
    const onProgress = jest.fn();
    await ingestWraps(ids, decrypt, { yieldEvery: 2, onProgress });
    // 5 fresh decrypts, yield after #2 and #4 → 2 progress callbacks
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(4, 5);
  });

  it('stops early when the signal is aborted (no upsert of partial work after abort)', async () => {
    const decrypt = jest.fn(async (w: IngestableWrap) => rowFor(w.id));
    const signal = { aborted: false };
    // abort after the first decrypt
    decrypt.mockImplementationOnce(async (w: IngestableWrap) => {
      signal.aborted = true;
      return rowFor(w.id);
    });
    const res = await ingestWraps([wrap('a'), wrap('b'), wrap('c')], decrypt, { signal });
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled(); // aborted → don't persist partial
    expect(res.ingested).toBe(0);
  });
});
