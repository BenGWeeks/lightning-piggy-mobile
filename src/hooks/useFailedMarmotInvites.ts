import { useSyncExternalStore } from 'react';

import {
  getFailedMarmotInvitesSnapshot,
  subscribeFailedMarmotInvites,
} from '../services/marmotFailedInvitesStore';
import type { FailedMarmotInvite } from '../services/marmotWelcomeOutcomes';

const NONE: readonly FailedMarmotInvite[] = [];

/** `owner`'s Marmot invites that couldn't be opened (#1269) — empty for any
 * other account, so a switch never shows the previous account's. */
export function useFailedMarmotInvites(owner: string | null): readonly FailedMarmotInvite[] {
  const snapshot = useSyncExternalStore(
    subscribeFailedMarmotInvites,
    getFailedMarmotInvitesSnapshot,
  );
  return owner && snapshot.owner === owner ? snapshot.invites : NONE;
}
