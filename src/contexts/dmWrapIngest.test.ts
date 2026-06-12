/**
 * Unit tests for the shared NIP-17 inbox-wrap ingest engine (#848) — the
 * seam where refreshDmInbox (nsec + Amber) and the cold thread-open path
 * persist decrypted rumors into the encrypted DM store. Covers the gate
 * ORDER (DB known-id → skip-set → decrypt → group-route → follow-gate),
 * the #743 skip-set semantics, Amber permission-denial draining, and the
 * abort contract (no rows / entries / skip-set writes from an aborted run).
 */

const mockSelectKnown = jest.fn();
const mockUpsert = jest.fn();
jest.mock('../services/dmDb', () => ({
  selectKnownEventIds: (...args: unknown[]) => mockSelectKnown(...args),
  upsertDmMessages: (...args: unknown[]) => mockUpsert(...args),
}));

const mockRouteGroup = jest.fn();
jest.mock('./nostrGroupRouting', () => ({
  tryRouteGroupRumor: (...args: unknown[]) => mockRouteGroup(...args),
}));

// Pacing is unit-tested in nostrDecryptPacing.test — stub it here so wrap
// counts, not timers, drive these tests.
jest.mock('./nostrDecryptPacing', () => ({
  NIP17_LOOP_YIELD_EVERY: 8,
  createYieldScheduler: jest.fn(() => ({
    maybeYield: jest.fn(async () => {}),
    yieldCount: 0,
    dispose: jest.fn(),
  })),
}));

const mockLoadSkipSet = jest.fn();
const mockWriteSkipSet = jest.fn();
jest.mock('./nostrDmCache', () => ({
  loadNip17SkipSet: (...args: unknown[]) => mockLoadSkipSet(...args),
  writeNip17SkipSet: (...args: unknown[]) => mockWriteSkipSet(...args),
}));

// partnerFromRumor / textForRumor are exercised against handcrafted rumors:
// the test rumor carries its own partnership verdict.
jest.mock('../utils/nip17Unwrap', () => ({
  partnerFromRumor: (rumor: { partnership?: { partnerPubkey: string; fromMe: boolean } }) =>
    rumor.partnership ?? null,
  textForRumor: (rumor: { content: string }) => rumor.content,
}));

import { ingestInboxWraps } from './dmWrapIngest';
import type { DmMessageRow } from '../services/dmDb';
import type { DecodedRumor } from '../utils/nip17Unwrap';

const OWNER = 'f'.repeat(64);
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

type TestRumor = {
  kind: number;
  created_at: number;
  content: string;
  partnership?: { partnerPubkey: string; fromMe: boolean };
  isGroup?: boolean;
};

const wrap = (id: string) => ({ id });
// Cast through unknown: the mocked partnerFromRumor/textForRumor above read
// the TestRumor shape, so DecodedRumor's envelope fields are irrelevant here.
const rumorFrom = (partner: string, over: Partial<TestRumor> = {}): DecodedRumor =>
  ({
    kind: 14,
    created_at: 100,
    content: `msg-from-${partner.slice(0, 4)}`,
    partnership: { partnerPubkey: partner, fromMe: false },
    ...over,
  }) as unknown as DecodedRumor;

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectKnown.mockResolvedValue(new Set<string>());
  mockUpsert.mockResolvedValue(undefined);
  mockLoadSkipSet.mockResolvedValue(new Set<string>());
  mockWriteSkipSet.mockResolvedValue(undefined);
  mockRouteGroup.mockImplementation(async (rumor: TestRumor) => ({
    kind: rumor.isGroup ? 'routed' : 'not-group',
  }));
});

describe('dmWrapIngest.ingestInboxWraps', () => {
  it('stores followed 1:1 rumors as rows and emits matching entries', async () => {
    const unwrap = jest.fn(async () => rumorFrom(ALICE));
    const res = await ingestInboxWraps({
      owner: OWNER,
      wraps: [wrap('w1')],
      unwrap,
      passesFollowGate: () => true,
      skipKey: 'skip_key',
    });
    expect(res.entries).toEqual([
      { id: 'w1', partnerPubkey: ALICE, fromMe: false, createdAt: 100, text: `msg-from-${ALICE.slice(0, 4)}`, wireKind: 14 }, // prettier-ignore
    ]);
    expect(res.stored).toBe(1);
    const rows: DmMessageRow[] = mockUpsert.mock.calls[0][0];
    expect(rows[0]).toEqual({
      owner: OWNER,
      eventId: 'w1',
      conversation: ALICE,
      createdAt: 100,
      sender: ALICE, // not fromMe → sender is the partner
      content: `msg-from-${ALICE.slice(0, 4)}`,
      fromMe: false,
      wireKind: 14,
    });
  });

  it('skips decrypt for DB-known wraps (decrypt-once) and reports them', async () => {
    mockSelectKnown.mockResolvedValue(new Set(['w1']));
    const unwrap = jest.fn(async () => rumorFrom(ALICE));
    const res = await ingestInboxWraps({
      owner: OWNER,
      wraps: [wrap('w1'), wrap('w2')],
      unwrap,
      passesFollowGate: () => true,
    });
    expect(unwrap).toHaveBeenCalledTimes(1); // only w2
    expect(res.alreadyKnown).toBe(1);
    expect(res.misses).toBe(1);
  });

  it('respects the #743 skip-set by default and bypasses it on user intent', async () => {
    mockLoadSkipSet.mockResolvedValue(new Set(['w1']));
    const unwrap = jest.fn(async () => rumorFrom(ALICE));
    const respected = await ingestInboxWraps({
      owner: OWNER,
      wraps: [wrap('w1')],
      unwrap,
      passesFollowGate: () => true,
      skipKey: 'skip_key',
    });
    expect(unwrap).not.toHaveBeenCalled();
    expect(respected.skipHits).toBe(1);

    const bypassed = await ingestInboxWraps({
      owner: OWNER,
      wraps: [wrap('w1')],
      unwrap,
      passesFollowGate: () => true,
      skipKey: 'skip_key',
      bypassSkipSet: true,
    });
    expect(unwrap).toHaveBeenCalledTimes(1);
    expect(bypassed.skipHits).toBe(0);
  });

  it('adds group-routed and non-followed rumors to the skip-set, stores neither', async () => {
    const unwrap = jest.fn(async (w: { id: string }) =>
      w.id === 'group' ? rumorFrom(ALICE, { isGroup: true }) : rumorFrom(BOB),
    );
    const res = await ingestInboxWraps({
      owner: OWNER,
      wraps: [wrap('group'), wrap('nonfollow')],
      unwrap,
      passesFollowGate: (pk) => pk !== BOB,
      skipKey: 'skip_key',
    });
    expect(res.entries).toEqual([]);
    expect(mockUpsert).not.toHaveBeenCalled();
    const [skipKey, persisted] = mockWriteSkipSet.mock.calls[0];
    expect(skipKey).toBe('skip_key');
    expect([...persisted].sort()).toEqual(['group', 'nonfollow']);
  });

  it('never touches the skip-set when no skipKey is given (thread-open path)', async () => {
    const unwrap = jest.fn(async () => rumorFrom(BOB, { isGroup: true }));
    await ingestInboxWraps({
      owner: OWNER,
      wraps: [wrap('g1')],
      unwrap,
      passesFollowGate: () => true,
    });
    expect(mockLoadSkipSet).not.toHaveBeenCalled();
    expect(mockWriteSkipSet).not.toHaveBeenCalled();
  });

  it('stops decrypting after an Amber PERMISSION_NOT_GRANTED but keeps prior rows', async () => {
    const unwrap = jest.fn(async (w: { id: string }) => {
      if (w.id === 'denied') {
        const err = new Error('PERMISSION_NOT_GRANTED') as Error & { code: string };
        err.code = 'PERMISSION_NOT_GRANTED';
        throw err;
      }
      return rumorFrom(ALICE);
    });
    const res = await ingestInboxWraps({
      owner: OWNER,
      wraps: [wrap('ok'), wrap('denied'), wrap('after')],
      unwrap,
      passesFollowGate: () => true,
      stopOnPermissionDenied: true,
    });
    expect(res.permissionDenied).toBe(true);
    expect(unwrap.mock.calls.map((c) => c[0].id)).toEqual(['ok', 'denied']); // 'after' drained
    expect(res.stored).toBe(1); // the pre-denial decrypt still persisted
    expect(mockUpsert.mock.calls[0][0].map((r: DmMessageRow) => r.eventId)).toEqual(['ok']);
  });

  it('treats an ordinary unwrap throw as a skip, not a permission denial', async () => {
    const unwrap = jest.fn(async (w: { id: string }) => {
      if (w.id === 'boom') throw new Error('bad wrap');
      return rumorFrom(ALICE);
    });
    const onSkip = jest.fn();
    const res = await ingestInboxWraps({
      owner: OWNER,
      wraps: [wrap('boom'), wrap('ok')],
      unwrap,
      passesFollowGate: () => true,
      stopOnPermissionDenied: true,
      onSkip,
    });
    expect(res.permissionDenied).toBe(false);
    expect(onSkip).toHaveBeenCalledWith('bad wrap', 'boom');
    expect(res.stored).toBe(1);
  });

  it('an aborted run emits no entries and persists no skip-set changes', async () => {
    const controller = new AbortController();
    const unwrap = jest.fn(async () => {
      controller.abort(); // abort mid-run, after the first decrypt started
      return rumorFrom(BOB, { isGroup: true }); // would dirty the skip-set
    });
    const res = await ingestInboxWraps({
      owner: OWNER,
      wraps: [wrap('w1'), wrap('w2')],
      unwrap,
      passesFollowGate: () => true,
      skipKey: 'skip_key',
      signal: controller.signal,
    });
    expect(res.entries).toEqual([]);
    expect(res.stored).toBe(0);
    expect(mockUpsert).not.toHaveBeenCalled(); // dmIngest skips upsert on abort
    expect(mockWriteSkipSet).not.toHaveBeenCalled();
  });
});
