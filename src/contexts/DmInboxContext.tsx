import { createContext, useContext } from 'react';
import type { DmInboxEntry } from '../utils/conversationSummaries';
import type { RefreshDmInboxOptions } from './nostrContextTypes';

/**
 * The DM-inbox slice (#806). Split out of `NostrContext` because `dmInbox` is
 * the hottest state in the app — re-`setState`'d on every decrypted message —
 * so leaving it in the shared `useNostr()` value re-rendered all ~40 consumers
 * on every DM. Served from a sibling provider (mirrors the #779 `contacts`
 * split) so only DM-list consumers re-render on inbox churn. The stable DM
 * *send/conversation* actions stay on `useNostr()`; only the volatile inbox
 * state + its controls live here.
 *
 * The provider is wired in `NostrProvider` (which owns the underlying
 * `useDmInbox` state); this module owns only the context object, its type, and
 * the consumer hook.
 */
export interface DmInboxContextType {
  dmInbox: DmInboxEntry[];
  dmInboxLoading: boolean;
  /**
   * Refresh the NIP-04 + NIP-17 DM inbox from read relays.
   *
   * Default (no arg / `force: false`): honours a 30s TTL — calls
   * within that window are no-ops. Safe to call from
   * `useFocusEffect` on the Messages tab without racking up relay
   * round-trips on every tab bounce.
   *
   * `force: true`: bypass the TTL and hit relays. Reserved for
   * explicit user-initiated refreshes (pull-to-refresh).
   *
   * `signal`: optional AbortSignal for cancelling the in-flight
   * refresh. Checked between batches in the decrypt loops so a
   * navigation-away can stop the JS-thread churn (#286). Aborting
   * is best-effort — a refresh that's mid-batch will finish that
   * batch (≤ DECRYPT_YIELD_EVERY items) before bailing out.
   */
  refreshDmInbox: (opts?: RefreshDmInboxOptions) => Promise<void>;
  /**
   * Arm the live NIP-17 DM subscription. Idempotent. Call from any
   * DM-receiving screen (Messages tab, ConversationScreen) via
   * useFocusEffect — first call opens the sub, subsequent are no-ops.
   * Cold-boot does NOT arm the sub by itself, so Home stays responsive.
   */
  armLiveDmSub: () => void;
}

export const DmInboxContext = createContext<DmInboxContextType | undefined>(undefined);

/**
 * Access the DM inbox (`dmInbox`) and its controls (`refreshDmInbox`,
 * `armLiveDmSub`) (#806). Served from a sibling provider so consumers of this
 * hook re-render on inbox churn while plain `useNostr()` consumers do not.
 */
export function useNostrDmInbox() {
  const context = useContext(DmInboxContext);
  if (!context) {
    throw new Error('useNostrDmInbox must be used within a NostrProvider');
  }
  return context;
}
