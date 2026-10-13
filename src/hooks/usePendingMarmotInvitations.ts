import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  getPendingMarmotInvitations,
  loadPendingMarmotInvitations,
  subscribePendingMarmotInvitations,
} from '../services/marmotWelcomeRouter';

export function usePendingMarmotInvitations(owner: string | null) {
  useEffect(() => {
    if (owner) loadPendingMarmotInvitations(owner);
  }, [owner]);
  const getSnapshot = useCallback(() => getPendingMarmotInvitations(owner), [owner]);
  return useSyncExternalStore(subscribePendingMarmotInvitations, getSnapshot);
}
