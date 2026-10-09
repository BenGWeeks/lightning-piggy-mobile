import type { ReverseSwapSendStage } from './reverseSwapSend';

/**
 * i18n key for the stage line PaymentProgressOverlay shows during a Send-screen
 * Boltz reverse swap (#1167).
 *
 * Paying the Lightning invoice and waiting for Boltz's on-chain lockup are ONE
 * stage, not two: Boltz's invoice is a hold invoice, so the payment stays
 * pending until our claim reveals the preimage, and Boltz reports no status
 * between "HTLC accepted" and "lockup broadcast". The next observable event
 * after dispatch is the verified lockup, which starts the claim.
 */
export function swapSendStageKey(stage: ReverseSwapSendStage): string {
  switch (stage) {
    case 'createSwap':
      return 'paymentProgressOverlay.swapStageCreating';
    case 'payAndLockup':
      return 'paymentProgressOverlay.swapStagePaying';
    case 'claimSwap':
    case 'cleanup':
      return 'paymentProgressOverlay.swapStageClaiming';
  }
}
