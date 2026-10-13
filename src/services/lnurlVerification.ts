import { fetch } from 'expo/fetch';
import { parsePublicUrl } from '../utils/publicUrl';
import type { PaymentCandidate } from '../utils/paymentCompletion';
import { throwIfAborted } from './nwcErrors';

export function isPaymentVerifyUrl(value: unknown): value is string {
  return typeof value === 'string' && parsePublicUrl(value, ['https']) !== null;
}

/** LUD-21: Expo's native transport rejects redirects before following them.
 * React Native's XHR-backed global fetch ignores the redirect option. */
export async function fetchPaymentVerification(
  url: string,
  signal: AbortSignal,
): Promise<PaymentCandidate | null> {
  if (!isPaymentVerifyUrl(url)) return null;
  throwIfAborted(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 2500);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.status === 'ERROR' ? null : data;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
