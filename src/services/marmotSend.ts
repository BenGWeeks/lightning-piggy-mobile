// The Marmot leg of the 1:1 send seam: every DM send function in
// useMessageSend (text, file, poll, wallet share) builds the same rumor it
// would gift-wrap for NIP-17, then — for a Marmot thread — hands it here
// instead. The rumor rides inside the DM's MLS group, so every message type
// the app supports works unchanged.

import type { SendHooks, SendResult } from '../contexts/useMessageSend';
import type { DeliveryStatus } from '../utils/dmDeliveryStatus';
import { marmotKindForAppKind } from './marmotInbox';
import {
  MarmotNoKeyPackageError,
  MarmotUnusableKeyPackageError,
  buildMarmotRumor,
  getMarmotSession,
  type MarmotSession,
} from './marmotSession';

export interface MarmotDraft {
  kind: number;
  content: string;
  tags?: string[][];
  created_at?: number;
}

/** Turn publish acks into the bubble's delivery tick. */
export function marmotDelivery(
  byRelay: Record<string, boolean>,
  meta: { eventId: string; kind: number },
): DeliveryStatus {
  const relayResults: DeliveryStatus['relayResults'] = {};
  for (const [url, ok] of Object.entries(byRelay)) relayResults[url] = ok ? 'ok' : 'failed';
  return {
    delivered: Object.values(byRelay).some(Boolean),
    relayResults,
    targetRelayCount: Object.keys(byRelay).length,
    ...meta,
  };
}

/** A user-facing reason a Marmot send couldn't start, or null. */
export function marmotSendError(e: unknown): string {
  if (e instanceof MarmotNoKeyPackageError) {
    return "This person hasn't set up Marmot yet — try NIP-17 instead.";
  }
  if (e instanceof MarmotUnusableKeyPackageError) {
    // Seen in the wild: MDK 0.8.x (older White Noise) key packages that the
    // Marmot v2 library can't decode, and expired ones.
    return "This person's Marmot app is out of date — its invite key isn't compatible. Ask them to update or reopen their Marmot app, or use NIP-17 for now.";
  }
  return (e as Error)?.message || 'Marmot send failed';
}

export function requireMarmotSession(pubkey: string): MarmotSession {
  const session = getMarmotSession();
  if (!session || session.pubkey !== pubkey) {
    throw new Error('Marmot is still starting up — try again in a moment.');
  }
  return session;
}

/**
 * Send `draft` to `recipient` over their Marmot DM (created on first use).
 * The rumor is sent as built — same tags and created_at — so content-addressed
 * ids (a NIP-88 poll's id is its rumor id) match what the sender stored. Only
 * text changes kind (14 → Marmot's 9), and text carries no correlation id.
 */
export async function sendMarmotDm(
  pubkey: string,
  recipient: string,
  draft: MarmotDraft,
  hooks?: SendHooks,
): Promise<SendResult> {
  try {
    const session = requireMarmotSession(pubkey);
    const dm = await session.getOrCreateDm(recipient);
    const rumor = buildMarmotRumor(pubkey, {
      kind: marmotKindForAppKind(draft.kind),
      content: draft.content,
      tags: draft.tags,
      created_at: draft.created_at,
    });
    // The app keys bubbles by its own kind (14 = text), not Marmot's 9.
    const meta = { eventId: rumor.id, kind: draft.kind };
    hooks?.onRumorReady?.({ ...meta, relays: dm.relays });
    const delivery = marmotDelivery(await session.sendRumor(dm.id, rumor), meta);
    hooks?.onDeliveryFinalized?.(delivery);
    return delivery.delivered
      ? { success: true, delivery }
      : { success: false, delivery, error: 'No relay accepted the message' };
  } catch (e) {
    return { success: false, error: marmotSendError(e) };
  }
}

/** Send an app rumor into a Marmot group (multi-member). Same "send the
 * rumor as built" rule as {@link sendMarmotDm}. */
export async function sendMarmotGroupRumor(
  pubkey: string,
  appGroupId: string,
  draft: MarmotDraft,
): Promise<{ success: boolean; wrapsPublished?: number; error?: string }> {
  try {
    const session = requireMarmotSession(pubkey);
    const rumor = buildMarmotRumor(pubkey, {
      kind: marmotKindForAppKind(draft.kind),
      content: draft.content,
      tags: draft.tags,
      created_at: draft.created_at,
    });
    const byRelay = await session.sendRumor(appGroupId, rumor);
    const accepted = Object.values(byRelay).filter(Boolean).length;
    return accepted > 0
      ? { success: true, wrapsPublished: accepted }
      : { success: false, error: 'No relay accepted the message' };
  } catch (e) {
    return { success: false, error: marmotSendError(e) };
  }
}
