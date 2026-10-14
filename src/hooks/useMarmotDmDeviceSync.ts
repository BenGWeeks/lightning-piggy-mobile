// While a Marmot 1:1 is open, add devices either person installed since the
// chat began (#1559) — so the contact's new app starts receiving before the
// next message, not only from it. Per CLAUDE.md: armed by focus (a blurred
// chat does nothing), staggered off the open (the relay lookup and
// signature checks never compete with the screen's first render), and
// bounded — the session checks a chat at most once per cooldown, and never
// prompts a remote signer from here (the add then waits for the next send).
import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { DM_DEVICE_SYNC_COOLDOWN_MS } from '../services/marmotDmDeviceSync';
import { getMarmotSession } from '../services/marmotSession';

/** Delay after the chat opens before the first check. */
export const DM_DEVICE_SYNC_OPEN_DELAY_MS = 3_000;

/** `peer` is the 1:1's contact, or null for a chat that isn't on Marmot. */
export function useMarmotDmDeviceSync(peer: string | null, owner: string | null | undefined) {
  useFocusEffect(
    useCallback(() => {
      if (!peer || !owner) return;
      const check = () => {
        const session = getMarmotSession();
        if (session?.pubkey !== owner) return;
        const dm = session.findDm(peer);
        if (dm) void session.syncDmDevices(dm.id, 'open').catch(() => undefined);
      };
      const first = setTimeout(check, DM_DEVICE_SYNC_OPEN_DELAY_MS);
      // A chat left open re-checks once per cooldown (a no-op in between).
      const again = setInterval(check, DM_DEVICE_SYNC_COOLDOWN_MS);
      return () => {
        clearTimeout(first);
        clearInterval(again);
      };
    }, [peer, owner]),
  );
}
