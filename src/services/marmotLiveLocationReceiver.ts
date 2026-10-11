// Feeds Marmot live-location coordinate updates (inner kind 20069, #1300) into
// the coalesced update store. One listener per signed-in account, for every
// Marmot DM and group: the viewers (conversation bubble, group bubble, Full
// Map) read the store and only trust an update from the sender of the start
// marker they render. marmot-ts has already authenticated `rumor.pubkey`
// against the MLS sender leaf (it drops forged authors), so the store key is
// sound. Our own updates (another of our devices) are ignored.

import { parseMarmotLiveUpdate } from './liveLocationWire';
import { ingestLiveUpdate } from './liveLocationUpdateStore';
import { subscribeMarmotSession, type MarmotMessageEvent } from './marmotSession';

/** Handle one Marmot app event; true when it was a live-location update. */
export function ingestMarmotLiveUpdate(myPubkey: string, event: MarmotMessageEvent): boolean {
  const payload = parseMarmotLiveUpdate(event.rumor);
  if (!payload) return false;
  const sender = event.rumor.pubkey.toLowerCase();
  if (sender !== myPubkey.toLowerCase()) ingestLiveUpdate(sender, payload);
  return true;
}

/** Listen on the active Marmot session (following session swaps) until disposed. */
export function startMarmotLiveLocationReceiver(myPubkey: string): () => void {
  let unsubscribeMessages: (() => void) | null = null;
  const unsubscribeSession = subscribeMarmotSession((session) => {
    unsubscribeMessages?.();
    unsubscribeMessages = null;
    if (!session || session.pubkey !== myPubkey) return;
    unsubscribeMessages = session.subscribe({
      onMessage: (event) => void ingestMarmotLiveUpdate(myPubkey, event),
    });
  });
  return () => {
    unsubscribeMessages?.();
    unsubscribeSession();
  };
}
