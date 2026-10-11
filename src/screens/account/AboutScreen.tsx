import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as nip19 from 'nostr-tools/nip19';
import { UserRound } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import NostrLoginSheet from '../../components/NostrLoginSheet';
import SendSheet from '../../components/SendSheet';
import FeedbackSheet from '../../components/FeedbackSheet';
import { createDmSender } from '../../utils/nostrDm';
import { fetchProfile, DEFAULT_RELAYS } from '../../services/nostrService';
import { useNostr } from '../../contexts/NostrContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { createAboutScreenStyles } from '../../styles/AboutScreen.styles';
import type { NostrProfile } from '../../types/nostr';
import { LIGHTNING_PIGGY_TEAM_NPUB, dmRecipient } from '../../constants/npubs';
import { appVersionLabel } from '../../utils/appVersion';

// Bumped key (#346) to evict pre-avatar caches that pinned an empty avatar circle.
const TEAM_PROFILE_CACHE_KEY = 'team_profile_cache_v2';
const LEGACY_TEAM_PROFILE_CACHE_KEY = 'team_profile_cache';

const AboutScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createAboutScreenStyles(colors), [colors]);
  const { isLoggedIn, signerType, sendDirectMessage } = useNostr();

  const [teamProfile, setTeamProfile] = useState<NostrProfile | null>(null);
  const [teamProfileLoading, setTeamProfileLoading] = useState(true);
  const [teamPictureError, setTeamPictureError] = useState(false);
  const [zapSheetOpen, setZapSheetOpen] = useState(false);
  const [feedbackSheetOpen, setFeedbackSheetOpen] = useState(false);
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);

  // Clear the load-failure flag whenever the picture URL changes so a refreshed kind-0 retries.
  useEffect(() => {
    setTeamPictureError(false);
  }, [teamProfile?.picture]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const decoded = nip19.decode(LIGHTNING_PIGGY_TEAM_NPUB);
        if (decoded.type !== 'npub') return;
        // Read v2 first, then fall back to the pre-#346 unversioned key so an offline upgrade keeps a cached profile.
        let cached = await AsyncStorage.getItem(TEAM_PROFILE_CACHE_KEY);
        let cameFromLegacy = false;
        if (!cached) {
          cached = await AsyncStorage.getItem(LEGACY_TEAM_PROFILE_CACHE_KEY);
          cameFromLegacy = cached != null;
        }
        if (cached) {
          const parsed = JSON.parse(cached) as NostrProfile;
          if (!cancelled) {
            setTeamProfile(parsed);
            setTeamProfileLoading(false);
          }
          // Migrate the legacy cache forward so subsequent mounts hit v2 directly.
          if (cameFromLegacy) {
            await AsyncStorage.setItem(TEAM_PROFILE_CACHE_KEY, cached);
          }
        }
        const fetched = await fetchProfile(decoded.data, DEFAULT_RELAYS);
        if (!cancelled && fetched) {
          setTeamProfile(fetched);
          await AsyncStorage.setItem(TEAM_PROFILE_CACHE_KEY, JSON.stringify(fetched));
        }
        // Only evict the legacy key after v2 is populated, so an offline upgrade never strands the user with no cache.
        if (await AsyncStorage.getItem(TEAM_PROFILE_CACHE_KEY)) {
          AsyncStorage.removeItem(LEGACY_TEAM_PROFILE_CACHE_KEY).catch(() => {});
        }
      } catch (error) {
        console.warn('Failed to fetch team profile:', error);
      } finally {
        if (!cancelled) setTeamProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AccountScreenLayout title={t('aboutScreen.title')}>
      <View style={styles.teamCard}>
        {teamProfileLoading ? (
          <ActivityIndicator size="small" color={colors.brandPink} style={{ padding: 20 }} />
        ) : teamProfile ? (
          <>
            {teamProfile.banner && (
              <Image
                source={{ uri: teamProfile.banner }}
                style={styles.teamBanner}
                resizeMode="cover"
              />
            )}
            <View style={styles.teamRow}>
              {teamProfile.picture && !teamPictureError ? (
                <ExpoImage
                  source={{ uri: teamProfile.picture }}
                  style={styles.teamPicture}
                  cachePolicy="memory-disk"
                  recyclingKey={teamProfile.picture}
                  autoplay={false}
                  onError={() => setTeamPictureError(true)}
                />
              ) : (
                <View style={styles.teamPicturePlaceholder}>
                  <UserRound size={28} color={colors.textBody} strokeWidth={1.75} />
                </View>
              )}
              <View style={styles.teamInfo}>
                <Text style={styles.teamName}>
                  {teamProfile.displayName || teamProfile.name || 'Lightning Piggy'}
                </Text>
                {teamProfile.about && (
                  <Text style={styles.teamAbout} numberOfLines={2}>
                    {teamProfile.about}
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.teamButtonRow}>
              {teamProfile.lud16 && (
                <TouchableOpacity
                  style={styles.zapButton}
                  onPress={() => setZapSheetOpen(true)}
                  accessibilityLabel={t('aboutScreen.zapLightningPiggy')}
                  testID="zap-team-button"
                >
                  <Text style={styles.zapButtonText}>
                    {'⚡'} {t('aboutScreen.zapTheTeam')}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.feedbackButton}
                onPress={() => setFeedbackSheetOpen(true)}
                accessibilityLabel={t('aboutScreen.sendFeedback')}
                testID="feedback-button"
              >
                <Text style={styles.feedbackButtonText}>{t('aboutScreen.sendFeedback')}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <Text style={styles.teamFallbackText}>{t('aboutScreen.couldNotLoadTeamProfile')}</Text>
        )}
      </View>

      <View style={[sharedAccountStyles.card, { marginTop: 16 }]}>
        <Text style={styles.aboutTitle}>Lightning Piggy</Text>
        <Text style={styles.aboutBody}>{t('aboutScreen.aboutBody')}</Text>
        <TouchableOpacity
          onPress={() => Linking.openURL('https://www.lightningpiggy.com')}
          accessibilityLabel={t('aboutScreen.openWebsite')}
          testID="about-website-link"
        >
          <Text style={styles.websiteLink}>www.lightningpiggy.com</Text>
        </TouchableOpacity>
      </View>

      <Text
        style={styles.versionText}
        testID="version-text"
        accessibilityLabel={t('aboutScreen.appVersion', { version: appVersionLabel })}
      >
        v{appVersionLabel}
      </Text>

      {teamProfile?.lud16 && (
        <SendSheet
          visible={zapSheetOpen}
          onClose={() => setZapSheetOpen(false)}
          initialAddress={teamProfile.lud16}
          initialPicture={teamProfile.picture || undefined}
          recipientPubkey={teamProfile.pubkey}
        />
      )}
      <FeedbackSheet
        visible={feedbackSheetOpen}
        onClose={() => setFeedbackSheetOpen(false)}
        onSend={createDmSender(dmRecipient(LIGHTNING_PIGGY_TEAM_NPUB), sendDirectMessage)}
        isLoggedIn={isLoggedIn}
        signerType={signerType}
        onLoginPress={() => setLoginSheetOpen(true)}
      />
      <NostrLoginSheet visible={loginSheetOpen} onClose={() => setLoginSheetOpen(false)} />
    </AccountScreenLayout>
  );
};

export default AboutScreen;
