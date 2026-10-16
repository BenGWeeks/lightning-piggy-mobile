import { useSyncExternalStore } from 'react';
import { appRelayPrefsRevision, subscribeAppRelayPrefs } from '../services/appRelayPrefs';
export function useAppRelayPrefs() {
  return useSyncExternalStore(subscribeAppRelayPrefs, appRelayPrefsRevision);
}
