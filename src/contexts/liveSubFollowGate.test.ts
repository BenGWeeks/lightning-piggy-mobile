/**
 * Unit tests for the live-sub follow-gate deferral buffer (#851 F2).
 *
 * The buffer recovers the live inbox-surface + OS-notification side-effects
 * of fresh inbound messages the live sub drops while the post-account-switch
 * follows list is still hydrating. These tests pin the contract the wiring in
 * `useDmInbox` / `nostrLiveDmSub` relies on: dedup by entry id, the bounded
 * cap, replay only for partners that now pass the gate, and that `clear`
 * (driven by sub teardown on wipe / account switch) drops everything so a
 * just-wiped wrap can never replay into the next identity's inbox.
 */

import {
  createLiveSubFollowGateBuffer,
  FOLLOW_GATE_DEFER_CAP,
  type DeferredFollowGateEntry,
} from './liveSubFollowGate';
import type { DmInboxEntry } from '../utils/conversationSummaries';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

function makeEntry(
  id: string,
  partnerPubkey: string,
  overrides: Partial<DmInboxEntry> = {},
): DeferredFollowGateEntry {
  const entry: DmInboxEntry = {
    id,
    partnerPubkey,
    fromMe: false,
    createdAt: 1_700_000_000,
    text: `msg ${id}`,
    wireKind: 14,
    ...overrides,
  };
  return { partnerPubkey, entry, notify: { title: 'New message', body: entry.text } };
}

describe('createLiveSubFollowGateBuffer', () => {
  it('starts empty', () => {
    const buf = createLiveSubFollowGateBuffer();
    expect(buf.size).toBe(0);
  });

  it('replays a deferred entry once its partner becomes followed', () => {
    const buf = createLiveSubFollowGateBuffer();
    buf.defer(makeEntry('w1', ALICE));
    expect(buf.size).toBe(1);

    const passed: DeferredFollowGateEntry[] = [];
    // Follows still hydrating, Alice not yet present — nothing replays.
    buf.reevaluate(new Set(), (item) => passed.push(item));
    expect(passed).toHaveLength(0);
    expect(buf.size).toBe(1);

    // Hydration completes with Alice followed — entry replays + leaves the buffer.
    buf.reevaluate(new Set([ALICE]), (item) => passed.push(item));
    expect(passed).toHaveLength(1);
    expect(passed[0].entry.id).toBe('w1');
    expect(buf.size).toBe(0);
  });

  it('keeps non-passing entries buffered while follows are partially hydrated', () => {
    const buf = createLiveSubFollowGateBuffer();
    buf.defer(makeEntry('w1', ALICE));
    buf.defer(makeEntry('w2', BOB));

    const passed: DeferredFollowGateEntry[] = [];
    // Only Alice followed so far — Bob stays buffered for the next hydration tick.
    buf.reevaluate(new Set([ALICE]), (item) => passed.push(item));
    expect(passed.map((p) => p.entry.id)).toEqual(['w1']);
    expect(buf.size).toBe(1);

    // Bob followed on the next tick — now he replays too.
    buf.reevaluate(new Set([ALICE, BOB]), (item) => passed.push(item));
    expect(passed.map((p) => p.entry.id)).toEqual(['w1', 'w2']);
    expect(buf.size).toBe(0);
  });

  it('dedups by entry id so a multi-relay re-delivery only buffers once', () => {
    const buf = createLiveSubFollowGateBuffer();
    buf.defer(makeEntry('w1', ALICE, { text: 'first' }));
    buf.defer(makeEntry('w1', ALICE, { text: 'second' }));
    expect(buf.size).toBe(1);

    const passed: DeferredFollowGateEntry[] = [];
    buf.reevaluate(new Set([ALICE]), (item) => passed.push(item));
    expect(passed).toHaveLength(1);
    // First write wins — the dedup short-circuits before overwriting.
    expect(passed[0].entry.text).toBe('first');
  });

  it('does not replay the same entry twice across hydration ticks', () => {
    const buf = createLiveSubFollowGateBuffer();
    buf.defer(makeEntry('w1', ALICE));

    const passed: DeferredFollowGateEntry[] = [];
    buf.reevaluate(new Set([ALICE]), (item) => passed.push(item));
    buf.reevaluate(new Set([ALICE]), (item) => passed.push(item));
    expect(passed).toHaveLength(1);
  });

  it('bounds the buffer at the cap, evicting the oldest entry', () => {
    const cap = 3;
    const buf = createLiveSubFollowGateBuffer(cap);
    buf.defer(makeEntry('w1', ALICE));
    buf.defer(makeEntry('w2', ALICE));
    buf.defer(makeEntry('w3', ALICE));
    buf.defer(makeEntry('w4', ALICE)); // evicts w1
    expect(buf.size).toBe(cap);

    const passed: DeferredFollowGateEntry[] = [];
    buf.reevaluate(new Set([ALICE]), (item) => passed.push(item));
    expect(passed.map((p) => p.entry.id)).toEqual(['w2', 'w3', 'w4']);
  });

  it('exposes a sane default cap', () => {
    expect(FOLLOW_GATE_DEFER_CAP).toBeGreaterThan(0);
  });

  it('clear() drops everything so a wiped wrap can never replay', () => {
    const buf = createLiveSubFollowGateBuffer();
    buf.defer(makeEntry('w1', ALICE));
    buf.defer(makeEntry('w2', BOB));
    expect(buf.size).toBe(2);

    // Sub teardown (wipe / account switch) clears the buffer atomically.
    buf.clear();
    expect(buf.size).toBe(0);

    const passed: DeferredFollowGateEntry[] = [];
    buf.reevaluate(new Set([ALICE, BOB]), (item) => passed.push(item));
    expect(passed).toHaveLength(0);
  });

  it('reevaluate is a no-op on an empty buffer', () => {
    const buf = createLiveSubFollowGateBuffer();
    const onPass = jest.fn();
    buf.reevaluate(new Set([ALICE]), onPass);
    expect(onPass).not.toHaveBeenCalled();
  });
});
