import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useNostr } from '../contexts/NostrContext';
import { loadInvitationKeys } from '../services/marmotInvitationKeys';
import {
  beginInvitationDeviceSummaryScan,
  cachedInvitationDeviceSummary,
  completeInvitationDeviceSummaryScan,
  type InvitationDeviceSummary,
} from '../utils/invitationDeviceSummary';

/**
 * Value for Settings → Messages → "Devices for new chats" (#1552). Shows the
 * last scan straight away (the full device screen refreshes it too) and only
 * re-reads relays when there's none for this account or it's over 10 minutes
 * old — so opening Messages settings doesn't fire a relay scan every time.
 */
export function useInvitationDeviceSummary(): InvitationDeviceSummary {
  const { pubkey, userRelays } = useNostr();
  const relays = useMemo(() => userRelays.map((r) => r.url), [userRelays]);
  const [summary, setSummary] = useState<InvitationDeviceSummary>({ state: 'checking' });
  const sequence = useRef(0);

  useFocusEffect(
    useCallback(() => {
      const seq = ++sequence.current;
      if (!pubkey) {
        setSummary({ state: 'unavailable' });
        return undefined;
      }
      const cached = cachedInvitationDeviceSummary(pubkey);
      setSummary(cached?.summary ?? { state: 'checking' });
      if (!cached?.fresh) {
        const scan = beginInvitationDeviceSummaryScan(pubkey);
        loadInvitationKeys(pubkey, relays)
          .then((inventory) => {
            if (seq !== sequence.current) return;
            const next = completeInvitationDeviceSummaryScan(pubkey, scan, inventory);
            setSummary(
              next ?? cachedInvitationDeviceSummary(pubkey)?.summary ?? { state: 'unavailable' },
            );
          })
          .catch(() => {
            // Keep a previous answer if we have one; otherwise say so plainly.
            if (seq === sequence.current && !cached) setSummary({ state: 'unavailable' });
          });
      }
      return () => {
        ++sequence.current;
      };
    }, [pubkey, relays]),
  );

  return summary;
}
