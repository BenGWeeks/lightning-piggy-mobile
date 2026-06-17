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
  const lockup = await boltzService.getSubmarineSwapLockup(swap.id);
  if (!lockup) {
    // Terminal failure with nothing left to refund (e.g. already refunded
    // on-chain). Report it so the user isn't left without feedback.
    Toast.show({
      type: 'error',
      text1: 'Swap failed',
      text2: reason.slice(0, 140),
      position: 'top',
      visibilityTime: 10000,
    });
    return;
  }
  const destAddr = await onchainService.getNextReceiveAddress(sourceWalletId);
  Alert.alert(
    'Swap Failed — Refund Available',
    `The swap failed (${reason}). Your on-chain funds can be refunded after block ${swap.timeoutBlockHeight}.`,
    [
      {
        text: 'Refund Now',
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
