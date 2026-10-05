import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import * as boltzService from '../services/boltzService';
import * as onchainService from '../services/onchainService';
import * as swapRecoveryService from '../services/swapRecoveryService';
import type { PersistedSubmarineSwap } from '../services/swapRecoveryService';
import * as SecureStore from 'expo-secure-store';
import { fireNotification } from '../services/notificationService';
import { resolveRefundWalletId } from './refundDestination';
import { swapSupportHint } from './swapSupportText';
import { blockEtaText } from './blockEta';

// Once-per-session guards: recovery runs on every app start/resume, and these
// informational prompts shouldn't repeat each time (the actionable Refund
// prompt still does, until the user acts).
const shownWaiting = new Set<string>();
const shownNoWallet = new Set<string>();

/** Toast + OS notification, so a swap needing action isn't missed. */
function notifySwapAttention(title: string, body: string): void {
  Toast.show({ type: 'error', text1: title, text2: body, position: 'top', visibilityTime: 12000 });
  void fireNotification({ kind: 'payment', title, body });
}

/**
 * Handle a submarine swap (on-chain → Lightning) that hit a terminal Boltz
 * failure status. If the on-chain lockup is still recoverable, prompt the
 * user to broadcast a refund; otherwise just report the failure.
 *
 * Extracted from TransferSheet's swap-completion handler (#894) so the
 * caller can stay a small timeout-vs-failure branch and this refund flow is
 * reusable / independently readable.
 */
export async function promptSubmarineRefund(
  swap: boltzService.SubmarineSwapResult,
  sourceWalletId: string,
  reason: string,
): Promise<void> {
  // Look up the on-chain lockup + a refund destination. Guarded because this
  // runs inside TransferSheet's detached background task — an unhandled reject
  // here (e.g. a missing/corrupt BDK wallet) would otherwise surface as an
  // unhandled promise rejection rather than a user-visible failure.
  let lockup: Awaited<ReturnType<typeof boltzService.getSubmarineSwapLockup>> | null = null;
  let destAddr: string | undefined;
  try {
    lockup = await boltzService.getSubmarineSwapLockup(swap.id, swap.address);
    if (lockup) destAddr = await onchainService.getNextReceiveAddress(sourceWalletId);
  } catch (e) {
    console.warn('[Transfer] submarine refund lookup failed:', e);
  }
  // Before the swap's timeout block the refund can't be broadcast yet — say
  // when it unlocks instead of offering a button that would be rejected.
  if (lockup && destAddr) {
    const height = await onchainService.getBlockHeight().catch(() => null);
    if (height !== null && height < swap.timeoutBlockHeight) {
      if (!shownWaiting.has(swap.id)) {
        shownWaiting.add(swap.id);
        const blocks = swap.timeoutBlockHeight - height;
        Alert.alert(
          'Refund not available yet',
          `Your ${swap.expectedAmount.toLocaleString()} sats are safe. The refund unlocks at block ${swap.timeoutBlockHeight} (${blockEtaText(blocks)} from now), and Lightning Piggy will offer it then. Keep the app installed until it's done.`,
          [{ text: 'OK' }],
        );
      }
      return;
    }
  }
  if (!lockup || !destAddr) {
    // Nothing recoverable (already refunded on-chain) or the lookup failed —
    // report the failure so the user isn't left without feedback.
    Toast.show({
      type: 'error',
      text1: 'Swap failed',
      text2: reason.slice(0, 140),
      position: 'top',
      visibilityTime: 10000,
    });
    return;
  }
  Alert.alert(
    'Swap Failed — Refund Available',
    `The swap failed (${reason}). Your on-chain funds become refundable at block ${swap.timeoutBlockHeight}. Tap Refund to broadcast the refund now — if that block hasn't been reached yet it will be rejected, so try again once it has.`,
    [
      {
        text: 'Refund',
        onPress: async () => {
          try {
            await boltzService.refundSwap(swap, lockup, destAddr);
            await SecureStore.deleteItemAsync(`submarine_swap_${swap.id}`);
            await swapRecoveryService.unregisterPendingSubmarineSwap(swap.id);
            Toast.show({
              type: 'success',
              text1: 'Refund sent',
              text2: 'Your refund transaction has been broadcast.',
              position: 'top',
              visibilityTime: 8000,
            });
          } catch (refundErr) {
            Toast.show({
              type: 'error',
              text1: 'Refund failed',
              text2: refundErr instanceof Error ? refundErr.message : 'Refund failed',
              position: 'top',
              visibilityTime: 10000,
            });
          }
        },
      },
      { text: 'Later', style: 'cancel' },
    ],
  );
}

/**
 * The submarine refund handler the recovery pass invokes when a persisted
 * submarine swap has failed (see swapRecoveryService.setSubmarineRefundHandler).
 * Rebuilds the SubmarineSwapResult shape `promptSubmarineRefund` needs from the
 * persisted record and delegates. Registered once at app start.
 */
export async function recoverSubmarineRefund(swap: PersistedSubmarineSwap): Promise<void> {
  if (!swap.swapTree) {
    // Older records (pre-recovery) lack the script tree — nothing we can
    // reconstruct, so point the user at whoever runs the swap server.
    notifySwapAttention(
      'Swap needs attention',
      `A pending swap (${swap.id.slice(0, 8)}…) failed and can't be auto-refunded. ${await swapSupportHint(swap.id)}`,
    );
    return;
  }
  // The destination is chosen now, not at swap creation (#1124): a swap made
  // before the user had an on-chain wallet can still refund into one added later.
  const walletId = await resolveRefundWalletId(swap.sourceWalletId);
  if (!walletId) {
    if (!shownNoWallet.has(swap.id)) {
      shownNoWallet.add(swap.id);
      notifySwapAttention(
        'Add an on-chain wallet for your refund',
        `A failed swap's ${swap.expectedAmount.toLocaleString()} sats can be refunded, but you have no on-chain wallet to receive them. Add one in Lightning Piggy and the refund will be offered.`,
      );
    }
    return;
  }
  await promptSubmarineRefund(
    {
      id: swap.id,
      address: swap.address,
      expectedAmount: swap.expectedAmount,
      timeoutBlockHeight: swap.timeoutBlockHeight,
      refundPrivateKey: swap.refundPrivateKey,
      claimPublicKey: swap.claimPublicKey,
      swapTree: swap.swapTree as boltzService.SubmarineSwapResult['swapTree'],
    },
    walletId,
    'recovered after app restart',
  );
}
