import {
  buildWelcomeOutcome,
  countWelcomeAttempt,
  keyPackageOwner,
  loadFailedInvites,
  parseWelcomeOutcome,
  permanentFailureOutcome,
  reverifyWelcomeOutcomes,
  STUCK_AFTER_ATTEMPTS,
  visibleFailedInvites,
  welcomeCommitFingerprint,
  type WelcomeOutcome,
} from './marmotWelcomeOutcomes';
import { createMemoryMarmotBackend } from './marmotStore';

jest.mock('@internet-privacy/marmot-ts', () => ({
  getWelcome: jest.fn((rumor: { content: string }) => {
    if (rumor.content === 'garbage') throw new Error('decode');
    return { encryptedGroupInfo: new TextEncoder().encode(`gi:${rumor.content}`) };
  }),
  getWelcomeKeyPackageEventId: jest.fn(
    (rumor: { tags: string[][] }) => rumor.tags.find((t) => t[0] === 'e')?.[1],
  ),
}));

const OWNER = 'a'.repeat(64);
const MAX = 'b'.repeat(64);
const OUR_SLOT = '1'.repeat(64);
const OTHER_SLOT = '2'.repeat(64);

const rumor = (over: { id?: string; content?: string; created_at?: number; kp?: string } = {}) => ({
  id: over.id ?? 'w1',
  pubkey: MAX.toUpperCase(),
  created_at: over.created_at ?? 1_000,
  kind: 444,
  tags: over.kp ? [['e', over.kp]] : [],
  content: over.content ?? 'welcome',
});

const outcome = (over: Partial<WelcomeOutcome>): WelcomeOutcome => ({
  result: 'failed',
  reason: 'noKey',
  sender: MAX,
  createdAt: 1_000,
  at: 2_000,
  ...over,
});

describe('buildWelcomeOutcome / parseWelcomeOutcome', () => {
  it('records sender, rumor time and the commit fingerprint', () => {
    const o = buildWelcomeOutcome(rumor(), 'joined');
    expect(o).toMatchObject({ result: 'joined', sender: MAX, createdAt: 1_000 });
    expect(o.commit).toMatch(/^[0-9a-f]{64}$/);
    // Per-device Welcomes of one invite share the fingerprint.
    expect(buildWelcomeOutcome(rumor({ id: 'w2' }), 'failed').commit).toBe(o.commit);
    expect(parseWelcomeOutcome(JSON.stringify(o))).toEqual(o);
  });

  it('treats pre-#1269 timestamp markers and junk as unknown', () => {
    expect(parseWelcomeOutcome('1760000000')).toBeNull();
    expect(parseWelcomeOutcome('{"result":"nope"}')).toBeNull();
    expect(parseWelcomeOutcome('not json')).toBeNull();
    expect(parseWelcomeOutcome(null)).toBeNull();
  });
});

describe('visibleFailedInvites', () => {
  it('shows a failed invite, hides joined / other-device ones', () => {
    const shown = visibleFailedInvites(
      new Map([
        ['failed', outcome({ commit: 'c1' })],
        ['joined', outcome({ result: 'joined', commit: 'c2', createdAt: 900 })],
        ['other', outcome({ result: 'otherDevice', commit: 'c3' })],
      ]),
    );
    expect(shown).toEqual([{ id: 'failed', sender: MAX, createdAt: 1_000, reason: 'noKey' }]);
  });

  it('hides a failure whose sibling Welcome (same commit) was joined', () => {
    const shown = visibleFailedInvites(
      new Map([
        ['tabletCopy', outcome({ commit: 'same' })],
        ['phoneCopy', outcome({ result: 'joined', commit: 'same' })],
      ]),
    );
    expect(shown).toEqual([]);
  });

  it('hides a stuck retry whose sibling Welcome (same commit) was joined', () => {
    const shown = visibleFailedInvites(
      new Map([['j', outcome({ result: 'joined', commit: 'c' })]]),
      [{ id: 'stuck', sender: MAX, createdAt: 10, reason: 'joinFailed', commit: 'c' }],
    );
    expect(shown).toEqual([]);
  });

  it('keeps unverified outcomes hidden', () => {
    expect(visibleFailedInvites(new Map([['u', outcome({ result: 'unverified' })]]))).toEqual([]);
  });

  it('adds stuck retryable joins, oldest first, without duplicating a decided one', () => {
    const shown = visibleFailedInvites(new Map([['decided', outcome({ createdAt: 50 })]]), [
      { id: 'stuck', sender: MAX, createdAt: 10, reason: 'joinFailed' },
      { id: 'decided', sender: MAX, createdAt: 50, reason: 'joinFailed' },
    ]);
    expect(shown.map((f) => [f.id, f.reason])).toEqual([
      ['stuck', 'joinFailed'],
      ['decided', 'noKey'],
    ]);
  });
});

describe('loadFailedInvites', () => {
  it('reads outcomes and pending Welcomes that keep failing (pending → hidden until then)', async () => {
    const backend = createMemoryMarmotBackend();
    await backend.set('welcomes', 'legacy', '1760000000');
    await backend.set('welcomes', 'f', JSON.stringify(outcome({ commit: 'x' })));
    await backend.set('welcomes', 'j', JSON.stringify(outcome({ result: 'joined', commit: 'y' })));
    await backend.set('pendingWelcomes', 'p', JSON.stringify(rumor({ id: 'p', created_at: 5 })));
    expect((await loadFailedInvites(backend)).map((f) => f.id)).toEqual(['f']);
    for (let i = 0; i < STUCK_AFTER_ATTEMPTS; i++) await countWelcomeAttempt(backend, 'p');
    expect(await loadFailedInvites(backend)).toEqual([
      { id: 'p', sender: MAX, createdAt: 5, reason: 'joinFailed' },
      { id: 'f', sender: MAX, createdAt: 1_000, reason: 'noKey' },
    ]);
  });
});

describe('keyPackageOwner', () => {
  const kpEvent = (slot: string, pubkey = OWNER) => ({
    id: 'kp1',
    pubkey,
    kind: 30443,
    tags: [['d', slot]],
  });
  const lookup = (events: unknown[] | Error, ownSlot: string | null = OUR_SLOT) => ({
    network: {
      request: jest.fn(async () => {
        if (events instanceof Error) throw events;
        return events as never;
      }),
    },
    relays: ['wss://r'],
    owner: OWNER,
    ownSlot,
  });

  it('is otherDevice for our key package in another install’s slot', async () => {
    const l = lookup([kpEvent(OTHER_SLOT)]);
    expect(await keyPackageOwner('kp1', l)).toBe('otherDevice');
    expect(l.network.request).toHaveBeenCalledWith(
      ['wss://r'],
      [
        { ids: ['kp1'], kinds: [30443], limit: 1 },
        { kinds: [30443], authors: [OWNER], limit: 1 },
      ],
    );
    // This install never published one: any of our keys is another device's.
    expect(await keyPackageOwner('kp1', lookup([kpEvent(OTHER_SLOT)], null))).toBe('otherDevice');
  });

  it('is notOurs for our own slot, a stranger’s key, or a key gone from relays', async () => {
    expect(await keyPackageOwner('kp1', lookup([kpEvent(OUR_SLOT)]))).toBe('notOurs');
    expect(await keyPackageOwner('kp1', lookup([kpEvent(OTHER_SLOT, MAX)]))).toBe('notOurs');
    // Gone: the relays answered (they returned our current key) but not kp1.
    const current = { ...kpEvent(OUR_SLOT), id: 'kpCurrent' };
    expect(await keyPackageOwner('kp1', lookup([current]))).toBe('notOurs');
    expect(await keyPackageOwner(undefined, lookup([]))).toBe('notOurs');
  });

  it('is unknown when relays can’t be asked or return nothing at all', async () => {
    expect(await keyPackageOwner('kp1', lookup(new Error('offline')))).toBe('unknown');
    // Adapters resolve [] on timeout / dead connections: not proof it's gone.
    expect(await keyPackageOwner('kp1', lookup([]))).toBe('unknown');
    expect(await keyPackageOwner('kp1', { ...lookup([]), relays: [] })).toBe('unknown');
  });
});

describe('permanentFailureOutcome / reverifyWelcomeOutcomes', () => {
  const lookup = (events: unknown[] | Error) => ({
    network: {
      request: jest.fn(async () => {
        if (events instanceof Error) throw events;
        return events as never;
      }),
    },
    relays: ['wss://r'],
    owner: OWNER,
    ownSlot: OUR_SLOT,
  });
  const otherDeviceKp = { id: 'kp1', pubkey: OWNER, kind: 30443, tags: [['d', OTHER_SLOT]] };
  // Relays that answer, without the named key package (it was deleted).
  const gone = [{ id: 'kpCurrent', pubkey: OWNER, kind: 30443, tags: [['d', OUR_SLOT]] }];
  const noSecret = new Error('No matching secret');

  it('classifies malformed, another device’s and genuinely failed invites', async () => {
    expect(
      await permanentFailureOutcome(rumor({ content: 'garbage' }), noSecret, lookup([])),
    ).toMatchObject({ result: 'failed', reason: 'malformed' });
    expect(
      await permanentFailureOutcome(rumor({ kp: 'kp1' }), noSecret, lookup([otherDeviceKp])),
    ).toMatchObject({ result: 'otherDevice' });
    expect(
      await permanentFailureOutcome(rumor({ kp: 'kp1' }), noSecret, lookup(gone)),
    ).toMatchObject({ result: 'failed', reason: 'noKey' });
    // Relays that returned nothing: can't tell yet.
    expect(await permanentFailureOutcome(rumor({ kp: 'kp1' }), noSecret, lookup([]))).toMatchObject(
      { result: 'unverified' },
    );
  });

  it('records an unreachable check as unverified, and settles it later', async () => {
    const o = await permanentFailureOutcome(rumor({ kp: 'kp1' }), noSecret, lookup(new Error('x')));
    expect(o).toMatchObject({ result: 'unverified', keyPackageId: 'kp1' });
    const backend = createMemoryMarmotBackend();
    await backend.set('welcomes', 'w1', JSON.stringify(o));
    expect(await reverifyWelcomeOutcomes(backend, lookup(new Error('still offline')))).toBe(false);
    expect(await loadFailedInvites(backend)).toEqual([]);
    expect(await reverifyWelcomeOutcomes(backend, lookup([otherDeviceKp]))).toBe(true);
    expect(parseWelcomeOutcome(await backend.get('welcomes', 'w1'))).toMatchObject({
      result: 'otherDevice',
    });
    expect(await loadFailedInvites(backend)).toEqual([]);
  });

  it('a settled unverified invite that was ours becomes a visible failure', async () => {
    const backend = createMemoryMarmotBackend();
    const o = await permanentFailureOutcome(rumor({ kp: 'kp1' }), noSecret, lookup(new Error('x')));
    await backend.set('welcomes', 'w1', JSON.stringify(o));
    expect(await reverifyWelcomeOutcomes(backend, lookup([]))).toBe(false); // still no answer
    await reverifyWelcomeOutcomes(backend, lookup(gone));
    expect((await loadFailedInvites(backend)).map((f) => f.id)).toEqual(['w1']);
  });
});

describe('loadFailedInvites (stuck siblings)', () => {
  it('hides a stuck retry once a sibling copy of the same invite joined', async () => {
    const backend = createMemoryMarmotBackend();
    const pending = rumor({ id: 'p', content: 'same-welcome' });
    await backend.set('pendingWelcomes', 'p', JSON.stringify(pending));
    for (let i = 0; i < STUCK_AFTER_ATTEMPTS; i++) await countWelcomeAttempt(backend, 'p');
    expect((await loadFailedInvites(backend)).map((f) => f.id)).toEqual(['p']);
    const commit = welcomeCommitFingerprint(pending);
    await backend.set('welcomes', 'sib', JSON.stringify(outcome({ result: 'joined', commit })));
    expect(await loadFailedInvites(backend)).toEqual([]);
  });
});
