import { Alert } from '../components/BrandedAlert';
import Toast from '../components/BrandedToast';
import * as boltzService from '../services/boltzService';
import * as onchainService from '../services/onchainService';
import * as SecureStore from 'expo-secure-store';

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
