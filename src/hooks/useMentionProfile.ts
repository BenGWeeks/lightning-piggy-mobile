import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useNostr } from '../contexts/NostrContext';
import { DEFAULT_RELAYS } from '../services/nostrRelayDefaults';
import { peekMentionProfile, subscribeMentionProfile } from '../services/nostrMentionProfiles';

/** Display-only lookup, shared across all mentions on focused screens. */
export function useMentionProfile(pubkey: string) {
  const { relays } = useNostr();
  const relayKey = relays
    .filter((r) => r.read)
    .map((r) => r.url)
    .sort()
    .join('|');
  const [state, setState] = useState(() => ({ pubkey, profile: peekMentionProfile(pubkey) }));
  useFocusEffect(
    useCallback(() => {
      setState({ pubkey, profile: peekMentionProfile(pubkey) });
      return subscribeMentionProfile(
        pubkey,
        relayKey ? relayKey.split('|') : DEFAULT_RELAYS,
        (profile) => setState({ pubkey, profile }),
      );
    }, [pubkey, relayKey]),
  );
  return state.pubkey === pubkey ? state.profile : peekMentionProfile(pubkey);
}
