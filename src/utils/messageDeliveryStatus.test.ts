/**
 * State-machine guards for the per-message delivery indicator
 * (`sending` / `sent` / `delivered` / `failed`). Issue #110.
 */

import {
  deliveryStatusFromPublishResult,
  nextDeliveryStatus,
  type MessageDeliveryStatus,
} from './messageDeliveryStatus';

describe('nextDeliveryStatus (delivery state machine)', () => {
  it('allows sending → sent on a successful publish', () => {
    expect(nextDeliveryStatus('sending', 'sent')).toBe('sent');
  });

  it('allows sending → failed on a rejected publish', () => {
    expect(nextDeliveryStatus('sending', 'failed')).toBe('failed');
  });

  it('allows sending → delivered (v2 fast path: relay observation lands before "sent" callback)', () => {
    expect(nextDeliveryStatus('sending', 'delivered')).toBe('delivered');
  });

  it('allows sent → delivered (v2: recipient relay observation)', () => {
    expect(nextDeliveryStatus('sent', 'delivered')).toBe('delivered');
  });

  it('refuses sent → sending (no regression to in-flight)', () => {
    expect(nextDeliveryStatus('sent', 'sending')).toBe('sent');
  });

  it('refuses sent → failed (NIP-20 OK already received; do not flip on a follow-up rejection)', () => {
    expect(nextDeliveryStatus('sent', 'failed')).toBe('sent');
  });

  it('treats delivered as terminal — does not regress to sent or failed', () => {
    expect(nextDeliveryStatus('delivered', 'sent')).toBe('delivered');
    expect(nextDeliveryStatus('delivered', 'failed')).toBe('delivered');
    expect(nextDeliveryStatus('delivered', 'sending')).toBe('delivered');
  });

  it('treats failed as terminal — retry mints a new message record rather than mutating this one', () => {
    expect(nextDeliveryStatus('failed', 'sent')).toBe('failed');
    expect(nextDeliveryStatus('failed', 'delivered')).toBe('failed');
    expect(nextDeliveryStatus('failed', 'sending')).toBe('failed');
  });

  it('is idempotent on a same-state transition', () => {
    const states: MessageDeliveryStatus[] = ['sending', 'sent', 'delivered', 'failed'];
    for (const s of states) {
      expect(nextDeliveryStatus(s, s)).toBe(s);
    }
  });
});

describe('deliveryStatusFromPublishResult', () => {
  it('maps success=true to "sent"', () => {
    expect(deliveryStatusFromPublishResult(true)).toBe('sent');
  });

  it('maps success=false to "failed"', () => {
    expect(deliveryStatusFromPublishResult(false)).toBe('failed');
  });
});
