import {
  watchSubmarineSwapStatus,
  classifySubmarineSwapStatus,
  fetchSwapStatus,
} from './boltzSwapStatus';
import { saveExternalSwap, type ExternalSwapState } from './externalSwapState';

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
 * on reopening; persisted pending state never authorizes another payment. */
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
      .then((status) => {
        // A later watcher update wins over a read started before it.
        if (channels.get(id) === current && current.revision === revision)
          publish({ id, status, trackingFailed: false });
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
const watching = new Set<string>();
export function trackExternalSwap(state: ExternalSwapState, recover: () => Promise<void>): void {
  if (
    watching.has(state.id) ||
    ['complete', 'failed'].includes(classifySubmarineSwapStatus(state.status))
  )
    return;
  watching.add(state.id);
  let writes = Promise.resolve();
  void watchSubmarineSwapStatus(state.id, (_phase, status, raw) => {
    publish({ id: state.id, status, raw, trackingFailed: false });
    writes = writes.catch(() => {}).then(() => saveExternalSwap({ ...state, status }));
    // Observe failures immediately, even if the watcher remains pending.
    void writes.catch(() => {});
  })
    .then(async () => {
      await writes.catch(() => {});
      await recover();
    })
    .catch(() => {
      publish({ id: state.id, status: null, trackingFailed: true });
      // Transport failure is ambiguous. Keep the recovery record for retry on
      // launch or pull-to-refresh; never label it expired or delete refund keys.
      void writes.catch(() => {});
    })
    .finally(() => watching.delete(state.id));
}
