/**
 * Coverage for the payment-error humanizer. The mapping rules are
 * order-sensitive — `Cancelled` is checked before `connectivity`, etc.
 * — so each pattern bucket has its own happy-path assertion plus a
 * couple of edge cases (empty / unknown / hex-stripped fallbacks).
 */

import { humanizePaymentError } from './paymentErrors';

describe('humanizePaymentError', () => {
  it('returns a generic message when given no input', () => {
    expect(humanizePaymentError(undefined).message).toBe('Payment failed. Please try again.');
    expect(humanizePaymentError(null).message).toBe('Payment failed. Please try again.');
    expect(humanizePaymentError('').message).toBe('Payment failed. Please try again.');
  });

  it('maps cancellation patterns to "Cancelled."', () => {
    for (const raw of ['Aborted', 'Cancelled', 'canceled by user']) {
      const out = humanizePaymentError(raw);
      expect(out.message).toBe('Cancelled.');
      expect(out.detail).toBe(raw.trim());
    }
  });

  it('maps connectivity patterns to the wallet-unreachable message', () => {
    for (const raw of [
      'reply timeout: event abc',
      'publish timed out',
      'failed to publish',
      'All promises were rejected',
      'wallet unreachable',
      'Network request failed',
      'websocket closed',
    ]) {
      const out = humanizePaymentError(raw);
      expect(out.message).toBe("Couldn't reach your wallet. Check your connection and try again.");
      expect(out.detail).toBe(raw.trim());
    }
  });

  it('maps insufficient-funds patterns to "Insufficient balance."', () => {
    expect(humanizePaymentError('Insufficient balance').message).toBe('Insufficient balance.');
    expect(humanizePaymentError('insufficient_balance').message).toBe('Insufficient balance.');
    expect(humanizePaymentError('insufficient').message).toBe('Insufficient balance.');
  });

  it('maps expired-invoice patterns to the expired message', () => {
    expect(humanizePaymentError('invoice has expired').message).toBe('This invoice has expired.');
    expect(humanizePaymentError('invoice expired').message).toBe('This invoice has expired.');
    expect(humanizePaymentError('expired').message).toBe('This invoice has expired.');
  });

  it('maps already-paid patterns to the already-paid message', () => {
    expect(humanizePaymentError('already paid').message).toBe(
      'This invoice has already been paid.',
    );
    expect(humanizePaymentError('already settled').message).toBe(
      'This invoice has already been paid.',
    );
    expect(humanizePaymentError('is_settled').message).toBe('This invoice has already been paid.');
  });

  it('strips 64-char hex event ids from fallback messages', () => {
    const hex = 'a'.repeat(64);
    const raw = `something failed for event ${hex} please retry`;
    const out = humanizePaymentError(raw);
    expect(out.message).not.toContain(hex);
    // Detail keeps the raw text so support can still see the event id.
    expect(out.detail).toBe(raw);
  });

  it('falls back to the generic message when stripping leaves only noise', () => {
    // After stripping the 64-char hex this is short / non-alphabetic and
    // looks "technical" — must collapse to the generic message.
    const out = humanizePaymentError(`!!!! ${'b'.repeat(64)} !!!!`);
    expect(out.message).toBe('Payment failed. Please try again.');
  });

  it('passes through clean error messages verbatim', () => {
    const out = humanizePaymentError('Recipient rejected the payment');
    expect(out.message).toBe('Recipient rejected the payment');
    expect(out.detail).toBe('Recipient rejected the payment');
  });
});
