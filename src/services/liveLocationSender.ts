/**
 * Live-location sends per transport (#1300), shared by the foreground
 * provider and the headless background task. None of these touch the user's
 * Nostr signer:
 *   - Marmot (1:1 and group): an MLS application message — kind 445 signed
 *     with a fresh ephemeral key inside marmot-ts (MIP-03), MLS-signed with
 *     the device's leaf key — so nsec, Amber and NIP-46 users all send
 *     updates in the background with no prompt;
 *   - NIP-17: the update is signed by the share's own session key (stored in
 *     SecureStore for the share's lifetime) and NIP-44 encrypted under the
 *     secret announced in the start marker.
 * The NIP-17 start / end markers are real DMs and go through the provider's
 * signer-aware `sendDirectRumor`; only group markers are sent from here.
 */

import * as SecureStore from 'expo-secure-store';
import { encodeLivePingPayload, type LivePingPayload } from './liveLocationService';
import { marmotLiveUpdateDraft } from './liveLocationWire';
import { transportFor } from './liveLocationPolicy';
import type { OutgoingSession } from './liveLocationStateMachine';
import { marmotKindForAppKind } from './marmotInbox';
import { buildMarmotRumor, getMarmotSession } from './marmotSession';
import { requireMarmotSession } from './marmotSend';
import { publishSignedEvent } from './nostrService';
import { createSessionLiveUpdateEvent, type LiveUpdateChannel } from './nostrLiveLocation';

const channelKey = (sessionId: string) => `live_location_channel_${sessionId}`;

export async function saveUpdateChannel(sessionId: string, channel: LiveUpdateChannel) {
  await SecureStore.setItemAsync(channelKey(sessionId), JSON.stringify(channel));
}

export async function loadUpdateChannel(sessionId: string): Promise<LiveUpdateChannel | null> {
  try {
    const raw = await SecureStore.getItemAsync(channelKey(sessionId));
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<LiveUpdateChannel>;
    return typeof c.pubkey === 'string' &&
      typeof c.secret === 'string' &&
      typeof c.sessionSecretKey === 'string'
      ? (c as LiveUpdateChannel)
      : null;
  } catch {
    return null;
  }
}

export async function deleteUpdateChannel(sessionId: string): Promise<void> {
  await SecureStore.deleteItemAsync(channelKey(sessionId)).catch(() => undefined);
}

/**
 * Send one coordinate update for `session`. Resolves true when a relay
 * accepted it; false (never throws) when it couldn't go — a dropped update
 * is normal and the next fix simply tries again.
 */
export async function sendLiveUpdate(
  myPubkey: string,
  session: OutgoingSession,
  payload: LivePingPayload,
  relays: string[],
): Promise<boolean> {
  try {
    if (transportFor(session) === 'marmot') {
      const marmot = getMarmotSession();
      // Never spin up MLS just for an update (e.g. a headless relaunch).
      if (!marmot || marmot.pubkey !== myPubkey) return false;
      // An update never creates a DM (the start marker did); no DM → drop it.
      const groupId = session.groupId ?? marmot.findDm(session.recipientPubkey)?.id;
      if (!groupId) return false;
      const rumor = buildMarmotRumor(myPubkey, marmotLiveUpdateDraft(payload));
      const byRelay = await marmot.sendRumor(groupId, rumor);
      return Object.values(byRelay).some(Boolean);
    }
    const channel = await loadUpdateChannel(session.sessionId);
    if (!channel) return false;
    await publishSignedEvent(
      createSessionLiveUpdateEvent(channel, encodeLivePingPayload(payload)),
      relays,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a start / end marker into a Marmot group, then apply it locally via
 * the inbound path (MLS never echoes our own sends) so it lands in the
 * group's message log like any other message.
 */
export async function sendMarmotGroupMarker(
  myPubkey: string,
  groupId: string,
  draft: { kind: number; content: string; tags: string[][] },
): Promise<boolean> {
  let session: ReturnType<typeof requireMarmotSession> | null = null;
  const rumor = buildMarmotRumor(myPubkey, { ...draft, kind: marmotKindForAppKind(draft.kind) });
  try {
    session = requireMarmotSession(myPubkey);
    const byRelay = await session.sendRumor(groupId, rumor);
    if (!Object.values(byRelay).some(Boolean)) throw new Error('No relay accepted the marker');
    session.deliverOwn(groupId, rumor);
    return true;
  } catch {
    // Saved to history before publishing: drop it so it never replays.
    if (session) await session.forgetRumor(groupId, rumor.id).catch(() => undefined);
    return false;
  }
}
