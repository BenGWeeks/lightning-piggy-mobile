/**
 * Per-message delivery state for outgoing messages — drives the
 * WhatsApp-style tick indicator in `MessageBubble`. Issue #110.
 *
 * State machine (v1):
 *
 *   sending ──success─▶ sent ──(future v2: relay observation)──▶ delivered
 *      │
 *      └────failure──▶ failed
 *
 * v1 covers what we can derive from the existing `pool.publish()`
 * return alone — no extra subscriptions, no recipient-relay polling.
 * `delivered` (double tick) is reserved here so the bubble's tick
 * renderer doesn't need a second pass when v2 lands; today no code
 * path transitions into it.
 *
 * Incoming (received) messages do not carry a delivery status — the
 * tick UI is `fromMe`-only.
 */
export type MessageDeliveryStatus = 'sending' | 'sent' | 'delivered' | 'failed';

/**
 * Allowed transitions, encoded as a closed lookup table so a buggy
 * caller can't push a bubble back from `sent` → `sending` mid-render.
 *
 * - `sending` is the initial optimistic state; resolves to `sent` or
 *   `failed`.
 * - `sent` may upgrade to `delivered` later (v2) but never regress.
 * - `delivered` is terminal.
 * - `failed` may be retried — the caller would mint a fresh message
 *   record rather than mutate this one, so `failed` is terminal here.
 */
const ALLOWED_TRANSITIONS: Record<MessageDeliveryStatus, ReadonlySet<MessageDeliveryStatus>> = {
  sending: new Set<MessageDeliveryStatus>(['sent', 'failed', 'delivered']),
  sent: new Set<MessageDeliveryStatus>(['delivered']),
  delivered: new Set<MessageDeliveryStatus>(),
  failed: new Set<MessageDeliveryStatus>(),
};

/**
 * Returns `next` if the transition is permitted, otherwise `current`.
 *
 * Defensive — the UI optimistically adds a `'sending'` bubble, then
 * awaits `sendDirectMessage`. If the same message somehow gets two
 * resolution callbacks (e.g. retry-on-mount + a stale promise from a
 * previous render), this prevents the bubble from flapping.
 */
export function nextDeliveryStatus(
  current: MessageDeliveryStatus,
  next: MessageDeliveryStatus,
): MessageDeliveryStatus {
  if (current === next) return current;
  return ALLOWED_TRANSITIONS[current].has(next) ? next : current;
}

/**
 * Convenience adapter for the common "publish completed, here's the
 * boolean success" path used by `sendDirectMessage` and friends.
 * Returns the resolved post-publish state for an in-flight message.
 */
export function deliveryStatusFromPublishResult(success: boolean): MessageDeliveryStatus {
  return success ? 'sent' : 'failed';
}
