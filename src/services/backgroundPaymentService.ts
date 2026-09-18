import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadIdentities } from './identitiesStore';
import { getNwcUrl, getWalletList } from './walletStorageService';
import { loadBackgroundDmEnabled } from './backgroundDmPreference';
import { firePaymentNotification, hasNotificationPermission } from './notificationService';
import { notifyPaymentOnce } from './paymentNotificationDedupe';
import { readBackgroundPayments } from './backgroundPaymentTransport';

const INTERVAL_MS = 60_000;
const CATCHUP_SECONDS = 24 * 60 * 60;
let controller: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Whether a background payment poll is worth running: opted in, permitted,
 * and the active identity owns at least one NWC wallet. Lets the service
 * hosts keep the foreground service alive for a payment-only identity (one
 * with NWC wallets but no DM relays) instead of tearing it down with the DM
 * subscription (#1100 review).
 */
export async function canWatchBackgroundPayments(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (!(await loadBackgroundDmEnabled()) || !(await hasNotificationPermission())) return false;
  const { activePubkey } = await loadIdentities();
  if (!activePubkey) return false;
  return (await getWalletList(activePubkey)).some((w) => w.walletType === 'nwc');
}

export function isBackgroundPaymentWatchRunning(): boolean {
  return controller !== null;
}

/** One pass; explicit account reads never mutate the foreground wallet scope. */
export async function checkBackgroundPayments(signal: AbortSignal): Promise<void> {
  if (Platform.OS !== 'android' || signal.aborted) return;
  if (!(await loadBackgroundDmEnabled()) || !(await hasNotificationPermission())) return;
  const { activePubkey } = await loadIdentities();
  if (!activePubkey) return;
  // Pass-wide scope: the preference and active identity this pass was read for.
  const scopeCurrent = async () =>
    (await loadBackgroundDmEnabled()) && (await loadIdentities()).activePubkey === activePubkey;
  const wallets = await getWalletList(activePubkey);
  for (const wallet of wallets) {
    if (signal.aborted) return;
    if (wallet.walletType !== 'nwc') continue;
    try {
      const key = `background_payment_start_v1:${activePubkey}:${wallet.id}`;
      const saved = await AsyncStorage.getItem(key);
      const now = Math.floor(Date.now() / 1000);
      const start = saved === null ? now : Number(saved);
      if (!Number.isSafeInteger(start) || start < 0) continue;
      if (saved === null) await AsyncStorage.setItem(key, String(start));
      // Prime eligibility while the UI is open, without extra wallet traffic.
      if (AppState.currentState === 'active') continue;
      const url = await getNwcUrl(wallet.id);
      if (!url || signal.aborted) continue;
      // Wallet scope: still listed for this identity, credential unchanged.
      const walletCurrent = async () =>
        (await getWalletList(activePubkey)).some((w) => w.id === wallet.id) &&
        (await getNwcUrl(wallet.id)) === url;
      const transactions = await readBackgroundPayments(url, signal);
      // A switch/removal/disable during a slow request must invalidate its result.
      if (signal.aborted || !(await scopeCurrent())) return;
      if (!(await walletCurrent())) continue;
      for (const tx of transactions) {
        if (
          !tx ||
          tx.type !== 'incoming' ||
          (tx.state && tx.state !== 'settled') ||
          !Number.isSafeInteger(tx.settled_at) ||
          tx.settled_at < Math.max(start, now - CATCHUP_SECONDS) ||
          tx.settled_at > now + 120 ||
          !/^[0-9a-f]{64}$/i.test(tx.payment_hash ?? '') ||
          !Number.isSafeInteger(tx.amount) ||
          tx.amount <= 0
        )
          continue;
        if (signal.aborted) return;
        // Re-validated per delivery, inside the dedupe queue: the credential,
        // wallet list, preference or identity can change between two
        // transactions of the same response (Copilot review, #1100).
        await notifyPaymentOnce(
          activePubkey,
          wallet.id,
          tx.payment_hash.toLowerCase(),
          () =>
            firePaymentNotification({
              kind: 'payment',
              walletId: wallet.id,
              amountSats: tx.amount / 1000,
            }),
          async () => !signal.aborted && (await scopeCurrent()) && (await walletCurrent()),
        );
      }
    } catch {
      // A wallet with revoked list_transactions permission, a locked keystore,
      // or an unreachable relay must not prevent other wallets being checked.
      // Never log the NWC URL, SDK error, invoice or decrypted transaction.
    }
  }
}

export function startBackgroundPaymentWatch(): void {
  if (Platform.OS !== 'android' || controller) return;
  const current = new AbortController();
  controller = current;
  const tick = async () => {
    try {
      await checkBackgroundPayments(current.signal);
    } catch {
      /* retry next pass */
    }
    if (controller === current && !current.signal.aborted) {
      timer = setTimeout(() => void tick(), INTERVAL_MS);
    }
  };
  void tick();
}

export function stopBackgroundPaymentWatch(): void {
  controller?.abort();
  controller = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
