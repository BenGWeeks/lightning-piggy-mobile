import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getRelayConnectionStatus } from '../services/nostrService';
import { connectionStatusByAppUrl } from '../utils/relayConnectionStatus';

/** Live relay connection status keyed by app relay URL, polled every 3 s
 * while the screen is focused (#1148). */
export function useRelayConnectionStatus(): Map<string, boolean> {
  const [status, setStatus] = useState<Map<string, boolean>>(new Map());
  useFocusEffect(
    useCallback(() => {
      const tick = () => setStatus(connectionStatusByAppUrl(getRelayConnectionStatus()));
      tick();
      const id = setInterval(tick, 3000);
      return () => clearInterval(id);
    }, []),
  );
  return status;
}
