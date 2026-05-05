/**
 * Phase model for the Transfer sheet's in-flight UI (issue #62).
 *
 * The sheet replaces its From/To/Amount form with a step-by-step status
 * card while a transfer is executing. This module owns the pure data
 * model — what steps each transfer type goes through, and how a
 * caller advances + completes + fails them — so the React component
 * just renders the result.
 *
 * Each transfer type has its own ordered step list. The component
 * holds a `TransferProgress` value, calls the helpers below to advance
 * it as the existing transfer flow makes progress, and the renderer
 * walks the steps deciding whether to show a checkmark / spinner /
 * empty circle for each row.
 *
 * Boltz cross-chain transfers ("ln-to-onchain", "onchain-to-ln") finish
 * the foreground portion at the "handoff" step — the background IIFE
 * continues to settle on-chain, but from the sheet's POV the work is
 * done and the user can close. The final step label is therefore
 * "Handoff to background" rather than the eventual on-chain settle.
 */

export type TransferType = 'ln-to-ln' | 'ln-to-onchain' | 'onchain-to-ln' | 'onchain-to-onchain';

export type TransferPhase = 'idle' | 'in-progress' | 'done' | 'failed';

export interface TransferStep {
  id: string;
  label: string;
}

export interface TransferProgress {
  phase: TransferPhase;
  steps: TransferStep[];
  /**
   * Index of the step currently in flight. While `phase === 'in-progress'`
   * this is the row that should render a spinner; rows < activeIndex are
   * complete (checkmark), rows > activeIndex are pending (empty circle).
   * On `done`, all rows are complete (activeIndex === steps.length).
   * On `failed`, the row at activeIndex is the one that errored.
   */
  activeIndex: number;
  /** Populated when `phase === 'failed'`. */
  errorMessage?: string;
}

/**
 * Step lists per transfer type. Wording matches the issue's mock
 * (issue #62) and the existing `progressMsg` strings in TransferSheet,
 * so the new step-list UI tells the same story the toasts/messages
 * have always told — just laid out as a checklist.
 */
export const STEPS_BY_TYPE: Record<TransferType, TransferStep[]> = {
  'ln-to-ln': [
    { id: 'invoice', label: 'Creating invoice' },
    { id: 'pay', label: 'Sending payment' },
    { id: 'refresh', label: 'Updating balances' },
  ],
  'onchain-to-onchain': [
    { id: 'broadcast', label: 'Broadcasting on-chain transaction' },
    { id: 'refresh', label: 'Updating balances' },
  ],
  'ln-to-onchain': [
    { id: 'swap', label: 'Creating Boltz swap' },
    { id: 'handoff', label: 'Handing off to background swap' },
  ],
  'onchain-to-ln': [
    { id: 'swap', label: 'Creating Boltz swap' },
    { id: 'broadcast', label: 'Broadcasting on-chain transaction' },
    { id: 'handoff', label: 'Handing off to background swap' },
  ],
};

/** Initial idle progress for a brand-new sheet (no transfer in flight). */
export const idleProgress = (): TransferProgress => ({
  phase: 'idle',
  steps: [],
  activeIndex: 0,
});

/**
 * Begin a transfer of the given type. The first step starts spinning
 * immediately; activeIndex is 0, phase flips to 'in-progress'.
 */
export const startTransfer = (transferType: TransferType): TransferProgress => ({
  phase: 'in-progress',
  steps: STEPS_BY_TYPE[transferType],
  activeIndex: 0,
});

/**
 * Mark the current step complete and start the next one. Caller invokes
 * this each time the existing transfer flow finishes a logical phase
 * (e.g. after `payInvoiceForWallet` resolves). If we're already past
 * the last step the call is a no-op — the caller should use
 * `completeTransfer()` to land in the terminal 'done' state instead.
 */
export const advanceTransfer = (progress: TransferProgress): TransferProgress => {
  if (progress.phase !== 'in-progress') return progress;
  const nextIndex = progress.activeIndex + 1;
  if (nextIndex >= progress.steps.length) {
    return completeTransfer(progress);
  }
  return { ...progress, activeIndex: nextIndex };
};

/**
 * Mark every step complete and flip phase to 'done'. Called by the
 * sheet at the end of the synchronous transfer paths (LN→LN,
 * on-chain→on-chain) and at the handoff point of the Boltz paths.
 */
export const completeTransfer = (progress: TransferProgress): TransferProgress => ({
  ...progress,
  phase: 'done',
  activeIndex: progress.steps.length,
});

/**
 * Mark the current step failed. Stays at the same activeIndex so the
 * UI can render an X / error icon on the row that broke. The caller's
 * existing Alert.alert flow still surfaces the human-readable reason —
 * this is just to keep the step list honest.
 */
export const failTransfer = (
  progress: TransferProgress,
  errorMessage: string,
): TransferProgress => ({
  ...progress,
  phase: 'failed',
  errorMessage,
});
