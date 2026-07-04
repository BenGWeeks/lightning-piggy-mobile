import {
  mergeConversationMessages,
  reconcileDeliveryStatus,
  dedupeLocalEchoes,
  DM_CONV_CAP,
} from './nostrDmCache';
import type { ConversationMessage } from './nostrContextTypes';
import type { DeliveryStatus } from '../utils/dmDeliveryStatus';

// Delivery-status persistence across the optimistic-row → relay-echo handoff
// (#856). These guard the two clobber points found on-device: the local- echo
// being replaced by the real-id wrap, and a subsequent re-decrypt of the same
// wrap (which carries no delivery info) overwriting the row that already has
// the tick.

const delivery: DeliveryStatus = {
  delivered: true,
  relayResults: { 'wss://a': 'ok', 'wss://b': 'failed' },
};

const local = (text: string, at: number): ConversationMessage => ({
  id: `local-${at}`,
  fromMe: true,
  text,
  createdAt: at,
  deliveryStatus: delivery,
});

const echo = (text: string, at: number): ConversationMessage => ({
  id: `real-${at}`,
  fromMe: true,
  text,
  createdAt: at,
});

describe('mergeConversationMessages — delivery status (#856)', () => {
  it('transfers delivery status from the dropped local- echo to the real-id wrap', () => {
    const cached = [local('gm', 1000)];
    const fresh = [echo('gm', 1001)]; // within LOCAL_DM_ECHO_WINDOW_SECS
    const merged = mergeConversationMessages(cached, fresh, DM_CONV_CAP);
    // The local row is dropped; the surviving real-id row carries the tick.
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('real-1001');
    expect(merged[0].deliveryStatus).toEqual(delivery);
  });

  it('keeps delivery status when the same wrap is re-decrypted with no delivery info', () => {
    // Prior merge already attached delivery to the real-id row (in cache).
    const cached: ConversationMessage[] = [{ ...echo('gm', 1001), deliveryStatus: delivery }];
    // Next refresh re-decrypts the same wrap — same id, but no delivery info.
    const fresh = [echo('gm', 1001)];
    const merged = mergeConversationMessages(cached, fresh, DM_CONV_CAP);
    expect(merged).toHaveLength(1);
    expect(merged[0].deliveryStatus).toEqual(delivery);
  });

  it('does not invent a delivery status on a received message', () => {
    const cached: ConversationMessage[] = [];
    const fresh: ConversationMessage[] = [
      { id: 'real-2000', fromMe: false, text: 'hi', createdAt: 2000 },
    ];
    const merged = mergeConversationMessages(cached, fresh, DM_CONV_CAP);
    expect(merged[0].deliveryStatus).toBeUndefined();
  });

  it('drops the local- echo (one bubble, not two) when the real wrap lands', () => {
    const cached = [local('yo', 500)];
    const fresh = [echo('yo', 501)];
    const merged = mergeConversationMessages(cached, fresh, DM_CONV_CAP);
    expect(merged.map((m) => m.id)).toEqual(['real-501']);
  });
});

describe('reconcileDeliveryStatus — in-memory carry-over (#856)', () => {
  it('carries delivery status onto the same id', () => {
    const prev: ConversationMessage[] = [{ ...echo('gm', 1000), deliveryStatus: delivery }];
    const next = [echo('gm', 1000)]; // same id, no delivery (relay echo)
    const out = reconcileDeliveryStatus(prev, next);
    expect(out[0].deliveryStatus).toEqual(delivery);
  });

  it('carries the optimistic local- tick onto the real-id echo (id changed)', () => {
    // Race: echo replaced the local- row before its cache write committed, so
    // the disk merge missed it — but in-memory state still has the local row.
    const prev = [local('gm', 1000)];
    const next = [echo('gm', 1001)]; // different id, within window
    const out = reconcileDeliveryStatus(prev, next);
    expect(out[0].id).toBe('real-1001');
    expect(out[0].deliveryStatus).toEqual(delivery);
  });

  it('does not carry across when outside the echo window', () => {
    const prev = [local('gm', 1000)];
    const next = [echo('gm', 1000 + 9999)];
    const out = reconcileDeliveryStatus(prev, next);
    expect(out[0].deliveryStatus).toBeUndefined();
  });

  it('keeps a next row’s own status over a prev one', () => {
    const other: DeliveryStatus = { delivered: true, relayResults: { 'wss://z': 'ok' } };
    const prev: ConversationMessage[] = [{ ...echo('gm', 1000), deliveryStatus: delivery }];
    const next: ConversationMessage[] = [{ ...echo('gm', 1000), deliveryStatus: other }];
    const out = reconcileDeliveryStatus(prev, next);
    expect(out[0].deliveryStatus).toEqual(other);
  });

  it('leaves received messages untouched', () => {
    const prev: ConversationMessage[] = [];
    const next: ConversationMessage[] = [{ id: 'r', fromMe: false, text: 'hi', createdAt: 5 }];
    const out = reconcileDeliveryStatus(prev, next);
    expect(out[0].deliveryStatus).toBeUndefined();
  });
});

describe('dedupeLocalEchoes — single-list read-side dedup (#850)', () => {
  it('collapses a local- row and its echo from ONE store read into one bubble with the tick', () => {
    // Both rows can coexist in the encrypted store briefly (append/echo race);
    // a single read must still render one bubble carrying the local- tick.
    const out = dedupeLocalEchoes([local('gm', 1000), echo('gm', 1001)]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('real-1001');
    expect(out[0].deliveryStatus).toEqual(delivery);
  });

  it('keeps a pending local- row that has no echo', () => {
    const out = dedupeLocalEchoes([local('unsent', 1000)]);
    expect(out.map((m) => m.id)).toEqual(['local-1000']);
  });

  it('sorts ascending and leaves unrelated rows alone', () => {
    const recv: ConversationMessage = { id: 'r1', fromMe: false, text: 'hi', createdAt: 999 };
    const out = dedupeLocalEchoes([echo('later', 1500), recv]);
    expect(out.map((m) => m.id)).toEqual(['r1', 'real-1500']);
  });
});

describe('rumorId carry-over — the delivery-store key (#857)', () => {
  // The optimistic local- row carries rumorId (the store key). A warm-DB echo
  // does NOT (the encrypted store doesn't persist it), so merge + reconcile must
  // copy it across or the bubble's tick would be stripped.
  const localWithRumor = (text: string, at: number): ConversationMessage => ({
    id: `local-${at}`,
    rumorId: `rumor-${at}`,
    fromMe: true,
    text,
    createdAt: at,
    deliveryStatus: delivery,
  });

  it('merge carries rumorId from the dropped local- row onto the real-id echo', () => {
    const cached = [localWithRumor('gm', 1000)];
    const fresh = [echo('gm', 1001)]; // warm-DB echo: no rumorId of its own
    const merged = mergeConversationMessages(cached, fresh, DM_CONV_CAP);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('real-1001');
    expect(merged[0].rumorId).toBe('rumor-1000');
  });

  it('merge keeps a fresh echo’s own rumorId (fresh decrypt supplies it)', () => {
    const cached: ConversationMessage[] = [];
    const fresh: ConversationMessage[] = [{ ...echo('gm', 1001), rumorId: 'rumor-fresh' }];
    const merged = mergeConversationMessages(cached, fresh, DM_CONV_CAP);
    expect(merged[0].rumorId).toBe('rumor-fresh');
  });

  it('reconcile carries rumorId onto the real-id echo across the id swap', () => {
    const prev = [localWithRumor('gm', 1000)];
    const next = [echo('gm', 1001)];
    const out = reconcileDeliveryStatus(prev, next);
    expect(out[0].id).toBe('real-1001');
    expect(out[0].rumorId).toBe('rumor-1000');
  });
});
