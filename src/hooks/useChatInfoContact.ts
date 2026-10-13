import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useNostr } from '../contexts/NostrContext';
import type { ContactProfileBodyData } from '../components/ContactProfileBody';
import { fetchProfile } from '../services/nostrService';
/** Seed from the thread, then fill identity fields while this info screen is focused.
 * The inbox's slim profile cache can omit NIP-05 and the banner. One bounded
 * kind-0 lookup fills them; there is no long-lived peer subscription here. */
export function useChatInfoContact(seed: ContactProfileBodyData | undefined) {
  const { relays } = useNostr();
  const relayKey = useMemo(
    () =>
      relays
        .filter((r) => r.read)
        .map((r) => r.url)
        .join('|'),
    [relays],
  );
  const [resolved, setResolved] = useState<ContactProfileBodyData | undefined>(seed);
  const contact = resolved?.pubkey === seed?.pubkey ? resolved : seed;
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (seed?.pubkey && !seed.nip05)
        void fetchProfile(seed.pubkey, relayKey.split('|').filter(Boolean))
          .then((profile) => {
            if (!cancelled && profile)
              setResolved({
                ...seed,
                name: profile.displayName ?? profile.name ?? seed.name,
                picture: profile.picture ?? seed.picture,
                nip05: profile.nip05 ?? seed.nip05,
                banner: profile.banner ?? seed.banner,
                about: profile.about ?? seed.about,
                lightningAddress: profile.lud16 ?? seed.lightningAddress,
              });
          })
          .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [seed, relayKey]),
  );
  return contact;
}
