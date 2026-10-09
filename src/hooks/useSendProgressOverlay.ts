import { useCallback, useRef, useState } from 'react';
import type { PaymentProgressState } from '../components/PaymentProgressOverlay';
import * as swapRecoveryService from '../services/swapRecoveryService';
import type { ReverseSwapSendStage } from '../utils/reverseSwapSend';

interface Options {
  onClose: () => void;
  setSending: (sending: boolean) => void;
}

/**
 * SendSheet's PaymentProgressOverlay state machine: the overlay state/error,
 * the per-send AbortController, the Boltz reverse-swap stage + dispatch flag
 * (#1167), and the Cancel / reply-timeout / dismiss handlers — including
 * "Continue in background", which hands an in-flight swap to recovery.
 */
export function useSendProgressOverlay({ onClose, setSending }: Options) {
  const [progressState, setProgressState] = useState<PaymentProgressState>('hidden');
  const [progressError, setProgressError] = useState<string | undefined>(undefined);
  // Whether the in-flight send is a Boltz reverse swap (Lightning → on-chain).
  // Drives the swap-aware "Boltz swap in progress" overlay copy vs the generic
  // "Still in flight" used for a plain Lightning send that's slow to confirm.
  const [inFlightIsSwap, setInFlightIsSwap] = useState(false);
  const [swapStage, setSwapStage] = useState<ReverseSwapSendStage | null>(null);
  const [swapDispatched, setSwapDispatched] = useState(false);
  // Per-send AbortController so the Cancel button on PaymentProgressOverlay
  // can abort the NWC call's publish → reply-timeout → poll-for-preimage
  // chain without waiting ~5 minutes for it to give up on its own (#175).
  const paymentAbortRef = useRef<AbortController | null>(null);
  const dismissedInFlightRef = useRef(false);
  const reversePaymentDispatchedRef = useRef(false);

  /** Reset the overlay for a new send and return its AbortController. */
  const beginSend = useCallback((): AbortController => {
    // Abort any stale in-flight send (shouldn't happen in normal flow,
    // but guards against a cancel-then-resend race where the previous
    // controller is still referenced).
    paymentAbortRef.current?.abort();
    const abortController = new AbortController();
    paymentAbortRef.current = abortController;
    setProgressError(undefined);
    setProgressState('sending');
    setInFlightIsSwap(false);
    setSwapStage(null);
    setSwapDispatched(false);
    dismissedInFlightRef.current = false;
    reversePaymentDispatchedRef.current = false;
    return abortController;
  }, []);

  /** Reverse-swap progress callbacks for one send. A superseded send (the
   *  user cancelled and sent again) must not repaint the new one. */
  const swapCallbacksFor = useCallback((abortController: AbortController) => {
    const isCurrent = () => paymentAbortRef.current === abortController;
    return {
      onStage: (stage: ReverseSwapSendStage) => {
        if (isCurrent()) setSwapStage(stage);
      },
      onPaymentDispatched: () => {
        if (!isCurrent()) return;
        reversePaymentDispatchedRef.current = true;
        setSwapDispatched(true);
      },
    };
  }, []);

  const handleReplyTimeout = useCallback(() => {
    setProgressError(undefined);
    setProgressState((prev) => (prev === 'sending' ? 'in-flight-extended' : prev));
  }, []);

  const handleCancelPayment = useCallback(() => {
    // Cancelling a reply cannot recall an already dispatched hold invoice.
    // Keep the in-flight warning visible until the user chooses background recovery.
    paymentAbortRef.current?.abort();
    setProgressState(reversePaymentDispatchedRef.current ? 'in-flight-extended' : 'hidden');
    setProgressError(undefined);
    setSending(false);
  }, [setSending]);

  // Track progressState in a ref so handleOverlayDismiss doesn't recapture
  // it on every state flip. Without this, the `sending` → `success`
  // transition rebuilds the callback, but Android's touch system can still
  // fire the previously-cached handler reference for an in-flight tap —
  // that stale closure reads `wasSuccess === false`, hides the overlay,
  // and never calls onClose. See #210.
  const progressStateRef = useRef(progressState);
  // Sync during render (not in a useEffect) so the ref is always current before any tap can fire. A useEffect runs after commit/paint, leaving a window where the OK button is visible but the ref still holds the previous value — which is exactly the race the second-round Copilot review on #210 flagged.
  progressStateRef.current = progressState;

  const handleOverlayDismiss = useCallback(() => {
    // Dismissing the overlay after a successful payment also closes the
    // parent sheet. On error we only dismiss the overlay so the user can
    // retry from the filled-in form.
    const prevState = progressStateRef.current;
    // "Continue in background": either the in-flight-extended state, or a
    // swap still `sending` whose hold-invoice payment is already dispatched
    // (#1167). The live flow keeps running; its outcome is no longer painted.
    const continueInBackground =
      prevState === 'in-flight-extended' ||
      (prevState === 'sending' && reversePaymentDispatchedRef.current);
    const shouldCloseParent = prevState === 'success' || continueInBackground;
    if (continueInBackground) {
      dismissedInFlightRef.current = true;
      // Kick a recovery pass so the claim is retried now rather than waiting
      // for the next app launch. Safe no-op (single-flight guarded) if the
      // lockup isn't claimable yet — pull-to-refresh / next foreground will retry.
      swapRecoveryService.recoverPendingSwaps().catch((e) => {
        console.warn('[Send] continue-in-background swap recovery failed:', e);
      });
    }
    setProgressState('hidden');
    setProgressError(undefined);
    // Defer the parent close so the overlay's hidden state renders first;
    // otherwise on a slow JS thread the parent sheet can tear down the
    // overlay component before the state update completes (#210).
    if (shouldCloseParent) setTimeout(() => onClose(), 0);
  }, [onClose]);

  return {
    progressState,
    setProgressState,
    progressError,
    setProgressError,
    inFlightIsSwap,
    setInFlightIsSwap,
    swapStage,
    canContinueInBackground: inFlightIsSwap && swapDispatched,
    paymentAbortRef,
    dismissedInFlightRef,
    beginSend,
    swapCallbacksFor,
    handleReplyTimeout,
    handleCancelPayment,
    handleOverlayDismiss,
  };
}
