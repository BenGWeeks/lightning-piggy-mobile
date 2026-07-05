import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ExploreNavigation, RootStackParamList } from '../navigation/types';
import { shortNpub } from '../utils/shortNpub';

type Nav = CompositeNavigationProp<
  ExploreNavigation,
  NativeStackNavigationProp<RootStackParamList>
>;

/**
 * Opens the full `ContactProfile` route for a pubkey, seeded with whatever
 * the caller already resolved (name / picture / Lightning address). Used by
 * the Geo-caches community leaderboard + recently-found rows so a tap on a
 * hider or finder drills into their profile — the in-app equivalent of the
 * website leaderboard's njump links. `ContactProfile` lives on the root
 * stack, so the row navigates through the composite navigator.
 */
export const useOpenContactProfile = (): ((
  pubkey: string,
  name: string | null,
  picture: string | null,
  lud16: string | null,
) => void) => {
  const navigation = useNavigation<Nav>();
  return useCallback(
    (pubkey, name, picture, lud16) => {
      navigation.navigate('ContactProfile', {
        contact: {
          pubkey,
          name: name ?? shortNpub(pubkey),
          picture,
          banner: null,
          about: null,
          lightningAddress: lud16,
          source: 'nostr',
        },
      });
    },
    [navigation],
  );
};
