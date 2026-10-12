import { watchSubmarineSwapStatus, classifySubmarineSwapStatus } from './boltzSwapStatus';
import { saveExternalSwap, type ExternalSwapState } from './externalSwapState';

// Settlement is app-level work: closing Move must not abandon a funded swap.
// A restart re-arms these watchers from the existing durable recovery index.
const watching = new Set<string>();
export function trackExternalSwap(state: ExternalSwapState, recover: () => Promise<void>): void {
  if (
    watching.has(state.id) ||
    ['complete', 'failed'].includes(classifySubmarineSwapStatus(state.status))
  )
    return;
  watching.add(state.id);
  let writes = Promise.resolve();
  void watchSubmarineSwapStatus(state.id, (_phase, status) => {
    writes = writes.then(() => saveExternalSwap({ ...state, status }));
  })
    .then(async () => {
      await writes;
      await recover();
    })
    .catch(() => {
      // Transport failure is ambiguous. Keep the recovery record for retry on
      // launch or pull-to-refresh; never label it expired or delete refund keys.
      void writes.catch(() => {});
    })
    .finally(() => watching.delete(state.id));
}
