import { mergeConversationMessages, DM_CONV_CAP } from './nostrDmCache';
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
