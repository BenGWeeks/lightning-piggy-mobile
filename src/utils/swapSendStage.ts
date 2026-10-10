import type { ChecklistStep } from '../components/StepChecklist';
import type { ReverseSwapSendStage } from './reverseSwapSend';

/** The Send overlay's Boltz reverse-swap checklist rows, in order (#1179). */
export const SWAP_SEND_STEPS = [
  { id: 'create', labelKey: 'paymentProgressOverlay.swapStepCreate' },
  { id: 'pay', labelKey: 'paymentProgressOverlay.swapStepPay' },
  { id: 'lockup', labelKey: 'paymentProgressOverlay.swapStepLockup' },
  { id: 'claim', labelKey: 'paymentProgressOverlay.swapStepClaim' },
] as const;

/**
 * Which checklist row a reverse swap send is on.
 *
 * Paying the invoice and waiting for Boltz's lockup are one swap stage
 * (`payAndLockup`): Boltz's invoice is a HOLD invoice, so the payment stays
 * pending until our claim reveals the preimage, and Boltz reports nothing
 * between "HTLC accepted" and "lockup broadcast". What the app does observe
 * is the dispatch of the payment request to the wallet, so that splits the
 * stage in two — "Sending the Lightning payment" is ticked once it's SENT
 * (not once Boltz accepted it; nothing reports that), then we wait for
 * Boltz's lockup. The verified lockup starts the claim.
 */
export function swapSendActiveStep(
  stage: ReverseSwapSendStage | null,
  dispatched: boolean,
): number {
  switch (stage) {
    case null:
    case 'createSwap':
      return 0;
    case 'payAndLockup':
      return dispatched ? 2 : 1;
    case 'claimSwap':
    case 'cleanup':
      return 3;
  }
}

/** The checklist for a reverse swap send at `stage` (labels as i18n keys). */
export function swapSendSteps(
  stage: ReverseSwapSendStage | null,
  dispatched: boolean,
): ChecklistStep[] {
  const active = swapSendActiveStep(stage, dispatched);
  return SWAP_SEND_STEPS.map((step, idx) => ({
    id: step.id,
    label: step.labelKey,
    status: idx < active ? 'complete' : idx === active ? 'active' : 'pending',
  }));
}
