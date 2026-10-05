import * as SecureStore from 'expo-secure-store';
import { createSubmarineSwapForward, type SwapFees } from './boltzService';
import { registerPendingSubmarineSwap } from './swapRecoveryService';
import { getActivePubkey } from './walletStorageService';

/** Prepare a transfer's swap and durably save refund material before funding. */
export async function createRecoverableSubmarineSwap(
  invoice: string,
  amountSats: number,
  sourceWalletId: string,
  approvedQuote: SwapFees,
) {
  if (!approvedQuote) throw new Error('Wait for the swap fee quote before sending');
  const swap = await createSubmarineSwapForward(invoice, amountSats, approvedQuote);
  await SecureStore.setItemAsync(
    `submarine_swap_${swap.id}`,
    // ownerPubkey: the swap index is device-wide; a refund must only ever land
    // in the creating identity's wallets (#1124).
    JSON.stringify({
      ...swap,
      sourceWalletId,
      ownerPubkey: getActivePubkey() ?? undefined,
      createdAt: Date.now(),
    }),
    { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
  );
  await registerPendingSubmarineSwap(swap.id);
  return swap;
}
