import { useCallback, useRef } from 'react';
import { InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nip19 from 'nostr-tools/nip19';
import type { Event } from 'nostr-tools';
import type { NostrProfile, RelayConfig, SignerType } from '../types/nostr';
import { signAccountEvent } from '../services/signAccountEvent';
import { ProfileUnavailableError, publishMergedProfile } from '../services/merchantProfileService';
import { useTranslation } from '../contexts/LocaleContext';
import { StaleRevisionError } from '../utils/marketSellerRevision';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import { sellerRelays } from '../services/marketSellerService';
import { perAccountKey } from '../services/perAccountStorage';
import type { ProfilePatch, ProfilePublishOptions } from '../utils/merchantProfile';

export function useProfilePublisher(input: {
  pubkey: string | null;
  isLoggedIn: boolean;
  signerType: SignerType | null;
  relays: RelayConfig[];
  profile: NostrProfile | null;
  setProfile: (profile: NostrProfile) => void;
  cacheKey: string;
  timestampKey: string;
}) {
  const { pubkey, isLoggedIn, signerType, relays, setProfile, cacheKey, timestampKey } = input;
  const t = useTranslation();
  const identity = useRef({ pubkey, isLoggedIn, signerType });
  if (
    identity.current.pubkey !== pubkey ||
    identity.current.isLoggedIn !== isLoggedIn ||
    identity.current.signerType !== signerType
  )
    identity.current = { pubkey, isLoggedIn, signerType };
  const initiatingIdentity = identity.current;
  return useCallback(
    async (patch: ProfilePatch, options?: ProfilePublishOptions): Promise<boolean> => {
      if (!pubkey || !isLoggedIn) return false;
      const isCurrent = () => identity.current === initiatingIdentity;
      try {
        const event = await publishMergedProfile({
          pubkey,
          relays: relays.filter((r) => r.read || r.write).map((r) => r.url),
          writeRelays: sellerRelays(relays),
          hasExistingProfile:
            !!input.profile || !!(await AsyncStorage.getItem(perAccountKey(cacheKey, pubkey))),
          patch,
          options,
          isCurrent,
          sign: async (template) =>
            (await signAccountEvent(template, { pubkey, isLoggedIn, signerType })) as Event | null,
        });
        if (!isCurrent()) return false;
        const data = JSON.parse(event.content);
        const profile: NostrProfile = {
          pubkey,
          npub: nip19.npubEncode(pubkey),
          name: data.name || null,
          displayName: data.display_name || null,
          picture: data.picture || null,
          banner: data.banner || null,
          about: data.about || null,
          lud16: data.lud16 || null,
          nip05: data.nip05 || null,
        };
        setProfile(profile);
        InteractionManager.runAfterInteractions(() => {
          AsyncStorage.setItem(perAccountKey(cacheKey, pubkey), JSON.stringify(profile)).catch(
            () => {},
          );
          AsyncStorage.setItem(perAccountKey(timestampKey, pubkey), Date.now().toString()).catch(
            () => {},
          );
        });
        return true;
      } catch (error) {
        if (options) throw error;
        if (error instanceof ProfileUnavailableError) {
          Toast.show({ type: 'error', text1: t('editProfileSheet.profileUnavailable') });
          return false;
        }
        if (error instanceof StaleRevisionError) {
          Alert.alert(t('market.sell.conflictTitle'), t('market.sell.shop.conflictBody'));
          return false;
        }
        console.warn('Failed to publish profile:', error);
        return false;
      }
    },
    [
      pubkey,
      input.profile,
      t,
      isLoggedIn,
      signerType,
      relays,
      setProfile,
      cacheKey,
      timestampKey,
      initiatingIdentity,
    ],
  );
}
