import { ingestMarmotLiveUpdate } from './marmotLiveLocationReceiver';
import { clearLiveUpdates, getLiveUpdate } from './liveLocationUpdateStore';
import { isTransientMarmotKind, skipTransientRumors } from './marmotTransientRumors';
import { isMarmotMessageKind, marmotRumorToDmRow } from './marmotInbox';
import { createMemoryMarmotBackend, createMarmotKvStore } from './marmotStore';
import type { MarmotMessageEvent } from './marmotSession';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const update = (pubkey: string, kind = 20069) =>
  ({
    group: { id: 'marmot:g', isDm: true, memberPubkeys: [PEER] },
    rumor: {
      id: `${pubkey.slice(0, 4)}${kind}`,
      pubkey,
      created_at: 1,
      kind,
      tags: [],
      content: JSON.stringify({
        lat: 1,
        lon: 2,
        accuracy: null,
        heading: null,
        ts: 5,
        sessionId: 's9',
      }),
    },
  }) as unknown as MarmotMessageEvent;

beforeEach(() => clearLiveUpdates());

describe('Marmot live-location receiver', () => {
  it("feeds a peer's update into the store under the MLS-authenticated author", () => {
    expect(ingestMarmotLiveUpdate(ME, update(PEER))).toBe(true);
    expect(getLiveUpdate(PEER, 's9')?.location).toEqual({ lat: 1, lon: 2, accuracyMeters: null });
  });

  it('ignores our own updates (another of our devices) and non-update events', () => {
    expect(ingestMarmotLiveUpdate(ME, update(ME))).toBe(true);
    expect(getLiveUpdate(ME, 's9')).toBeUndefined();
    expect(ingestMarmotLiveUpdate(ME, update(PEER, 9))).toBe(false);
  });
});

describe('transient Marmot events', () => {
  it('are the NIP-01 ephemeral range', () => {
    expect(isTransientMarmotKind(20069)).toBe(true);
    expect(isTransientMarmotKind(9)).toBe(false);
    expect(isTransientMarmotKind(30443)).toBe(false);
  });

  it('never become chat rows', () => {
    expect(isMarmotMessageKind(20069)).toBe(false);
    expect(isMarmotMessageKind(25000)).toBe(false);
    expect(isMarmotMessageKind(9)).toBe(true);
    expect(marmotRumorToDmRow(ME, update(PEER))).toBeNull();
  });

  it('are never written to the durable rumor history', async () => {
    const store = skipTransientRumors(
      createMarmotKvStore<{ id: string; kind: number }>(createMemoryMarmotBackend(), 'history:g'),
    );
    await store.setItem('u1', { id: 'u1', kind: 20069 });
    await store.setItem('m1', { id: 'm1', kind: 9 });
    expect(await store.keys()).toEqual(['m1']);
    expect(await store.getItem('m1')).toEqual({ id: 'm1', kind: 9 });
  });
});
