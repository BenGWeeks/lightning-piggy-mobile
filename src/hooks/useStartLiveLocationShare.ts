import { useCallback, useRef } from 'react';
import { Alert } from '../components/BrandedAlert';
import { useLiveLocation } from '../contexts/LiveLocationContext';
import { getCurrentLocation } from '../services/locationService';
import { confirmLocationShare } from '../utils/confirmLocationShare';
import type { DmProtocol } from '../utils/dmProtocol';
import { t } from '../i18n';

/** Keep consent ahead of the provider's session, marker and location watcher. */
export function useStartLiveLocationShare({
  pubkey,
  name,
  protocol,
  closePicker,
  appendOptimisticLocal,
}: {
  pubkey: string;
  name: string;
  protocol: DmProtocol;
  closePicker: () => void;
  appendOptimisticLocal: (text: string) => void;
}) {
  const { startShare } = useLiveLocation();
  const pending = useRef(false);
  return useCallback(
    async (durationMs: number) => {
      if (pending.current) return;
      pending.current = true;
      closePicker();
      try {
        const fix = await getCurrentLocation();
        if (!fix.ok) {
          Alert.alert(t('conversationScreen.couldNotStartLiveShareTitle'), fix.message);
          return;
        }
        if (!(await confirmLocationShare(fix.location, { name, live: true }))) return;
        const result = await startShare(pubkey, durationMs, protocol);
        if (!result.ok) {
          Alert.alert(t('conversationScreen.couldNotStartLiveShareTitle'), result.error);
          return;
        }
        // Use the published marker verbatim so the relay echo deduplicates.
        appendOptimisticLocal(result.markerText);
      } finally {
        pending.current = false;
      }
    },
    [pubkey, name, protocol, closePicker, startShare, appendOptimisticLocal],
  );
}
