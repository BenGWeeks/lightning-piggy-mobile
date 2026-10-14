import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useNostr } from '../contexts/NostrContext';
import { loadInvitationKeys } from '../services/marmotInvitationKeys';
import { groupInvitationDevices } from '../services/marmotInvitationDevices';
import {
  cachedInvitationDeviceSummary,
  rememberInvitationDeviceSummary,
  summariseInvitationDevices,
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
        loadInvitationKeys(pubkey, relays)
          .then((inventory) => {
            const next = summariseInvitationDevices(
              groupInvitationDevices(inventory.keys, inventory.localSlot),
            );
            rememberInvitationDeviceSummary(pubkey, next);
            if (seq === sequence.current) setSummary(next);
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
