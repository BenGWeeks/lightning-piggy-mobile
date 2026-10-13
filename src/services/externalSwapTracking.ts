import {
  watchSubmarineSwapStatus,
  classifySubmarineSwapStatus,
  fetchSwapStatus,
} from './boltzSwapStatus';
import { loadExternalSwap, saveExternalSwap, type ExternalSwapState } from './externalSwapState';
import { recoverPendingSwaps } from './swapRecoveryService';

export interface ExternalSwapUpdate {
  id: string;
  status: string | null;
  trackingFailed: boolean;
  raw?: { transaction?: { id?: string } };
}
type Listener = (update: ExternalSwapUpdate) => void;
interface Channel {
  listeners: Set<Listener>;
  revision: number;
  refresh?: Promise<void>;
}
const channels = new Map<string, Channel>();

function publish(update: ExternalSwapUpdate): void {
  const channel = channels.get(update.id);
  if (!channel) return;
  channel.revision++;
  for (const listener of channel.listeners) listener(update);
}

/** Observe the app-owned watcher. A shared one-shot read validates instructions
 * and re-arms failed tracking on reopening; saved state never authorizes payment. */
export function subscribeExternalSwap(id: string, listener: Listener): () => void {
  let channel = channels.get(id);
  if (!channel) {
    channel = { listeners: new Set(), revision: 0 };
    channels.set(id, channel);
  }
  channel.listeners.add(listener);
  listener({ id, status: null, trackingFailed: false });
  if (!channel.refresh) {
    const current = channel;
    const revision = current.revision;
    current.refresh = fetchSwapStatus(id)
      .then(async (status) => {
        // A later watcher update wins over a read started before it.
        if (channels.get(id) === current && current.revision === revision) {
          const tracker = trackers.get(id);
          if (tracker) {
            trackExternalSwap({ ...tracker.state, status }, tracker.recover);
          } else {
            // Offline startup can leave a durable request with no in-memory
            // tracker. Restore app-owned settlement work before authorizing payment.
            const state = await loadExternalSwap(id);
            if (!state) throw new Error(`Missing saved external swap ${id}`);
            if (channels.get(id) !== current || current.revision !== revision) return;
            trackExternalSwap({ ...state, status }, recoverPendingSwaps);
          }
          if (channels.get(id) === current && current.revision === revision)
            publish({ id, status, trackingFailed: false });
        }
      })
      .catch(() => {
        if (channels.get(id) === current && current.revision === revision)
          publish({ id, status: null, trackingFailed: true });
      })
      .finally(() => {
        current.refresh = undefined;
      });
  }
  return () => {
    channel.listeners.delete(listener);
    if (!channel.listeners.size && channels.get(id) === channel) channels.delete(id);
  };
}

// Settlement is app-level work: closing Move must not abandon a funded swap.
// A restart re-arms these watchers from the existing durable recovery index.
interface Tracker {
  state: ExternalSwapState;
  recover: () => Promise<void>;
  active: boolean;
}
// Failed transports retain the app-owned recovery context for a later reopen.
const trackers = new Map<string, Tracker>();
export function trackExternalSwap(state: ExternalSwapState, recover: () => Promise<void>): void {
  if (
    trackers.get(state.id)?.active ||
    ['complete', 'failed'].includes(classifySubmarineSwapStatus(state.status))
  )
    return;
  const tracker: Tracker = { state, recover, active: true };
  trackers.set(state.id, tracker);
  let writes = Promise.resolve();
  void watchSubmarineSwapStatus(state.id, (_phase, status, raw) => {
    tracker.state = { ...state, status };
    publish({ id: state.id, status, raw, trackingFailed: false });
    writes = writes.catch(() => {}).then(() => saveExternalSwap({ ...state, status }));
    // Observe failures immediately, even if the watcher remains pending.
    void writes.catch(() => {});
  })
    .then(async () => {
      await writes.catch(() => {});
      trackers.delete(state.id);
      await recover();
    })
    .catch(() => {
      tracker.active = false;
      publish({ id: state.id, status: null, trackingFailed: true });
      // Transport failure is ambiguous. Keep the recovery record for retry on
      // launch or pull-to-refresh; never label it expired or delete refund keys.
      void writes.catch(() => {});
    });
}
