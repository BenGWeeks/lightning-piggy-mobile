import { useCallback, useRef } from 'react';
import { Alert } from '../components/BrandedAlert';
import { useLiveLocation, type LiveShareTarget } from '../contexts/LiveLocationContext';
import { getCurrentLocation } from '../services/locationService';
import { confirmLocationShare } from '../utils/confirmLocationShare';
import { t } from '../i18n';

/** Keep consent ahead of the provider's session, marker and location tracking.
 *  `target` is a 1:1 chat or a Marmot group (#1300); `name` labels the
 *  consent prompt and the "Sharing with …" notification. */
export function useStartLiveLocationShare({
  target,
  name,
  closePicker,
  appendOptimisticLocal,
}: {
  target: LiveShareTarget;
  name: string;
  closePicker: () => void;
  /** 1:1 only — a group's marker lands in its log through the inbound path. */
  appendOptimisticLocal?: (text: string) => void;
}) {
  const { startShare } = useLiveLocation();
  const pending = useRef(false);
  const targetKey = JSON.stringify(target);
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
        const result = await startShare({ ...target, label: name }, durationMs);
        if (!result.ok) {
          Alert.alert(t('conversationScreen.couldNotStartLiveShareTitle'), result.error);
          return;
        }
        // Use the published marker verbatim so the echo deduplicates.
        appendOptimisticLocal?.(result.markerText);
      } finally {
        pending.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey is the stable surrogate for target
    [targetKey, name, closePicker, startShare, appendOptimisticLocal],
  );
}
