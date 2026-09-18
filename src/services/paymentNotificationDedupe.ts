import AsyncStorage from '@react-native-async-storage/async-storage';

// Both the headless service and mounted UI share this queue: the native
// BackgroundDmService dispatches its headless task into the application's
// single ReactHost `currentReactContext` (see BackgroundDmService.kt →
// startHeadlessTask), so there is exactly one JS runtime per process and this
// module-level promise chain serialises every claim. Persist before posting so
// a process restart cannot announce an already claimed payment.
let queue: Promise<unknown> = Promise.resolve();
export function notifyPaymentOnce(
  owner: string,
  walletId: string,
  paymentId: string,
  send: () => Promise<string | null>,
  // Re-checked inside the serialised queue, right before the claim is written
  // and again after — may be async so callers can re-read storage-backed
  // scope (identity / wallet list / credential) per delivery.
  isCurrent: () => boolean | Promise<boolean> = () => true,
): Promise<string | null> {
  const operation = queue
    .catch(() => {})
    .then(async () => {
      const key = `payment_notifications_v1:${owner}:${walletId}`;
      const raw = await AsyncStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) throw new Error('Invalid payment notification history');
      const seen = parsed.filter((id): id is string => typeof id === 'string');
      if (seen.includes(paymentId) || !(await isCurrent())) return null;
      await AsyncStorage.setItem(key, JSON.stringify([...seen, paymentId].slice(-2048)));
      if (!(await isCurrent())) {
        await AsyncStorage.setItem(key, JSON.stringify(seen));
        return null;
      }
      let result: string | null = null;
      try {
        result = await send();
        return result;
      } finally {
        // Permission denial / scheduling failure is retryable on the next pass.
        if (result === null) await AsyncStorage.setItem(key, JSON.stringify(seen));
      }
    });
  queue = operation;
  return operation;
}
