import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from '../../components/BrandedAlert';
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
import type { Palette } from '../../styles/palettes';
import type { NostrProfile } from '../../types/nostr';
import { LIGHTNING_PIGGY_TEAM_NPUB, dmRecipient } from '../../constants/npubs';
import { appVersion } from '../../utils/appVersion';

// Bumped key (#346) to evict pre-avatar caches that pinned an empty avatar circle.
const TEAM_PROFILE_CACHE_KEY = 'team_profile_cache_v2';

const AboutScreen: React.FC = () => {
  const colors = useThemeColors();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { isLoggedIn, signerType, sendDirectMessage } = useNostr();

  const [teamProfile, setTeamProfile] = useState<NostrProfile | null>(null);
  const [teamProfileLoading, setTeamProfileLoading] = useState(true);
  const [teamPictureError, setTeamPictureError] = useState(false);
  const [zapSheetOpen, setZapSheetOpen] = useState(false);
  const [feedbackSheetOpen, setFeedbackSheetOpen] = useState(false);
  const [loginSheetOpen, setLoginSheetOpen] = useState(false);

  const [devMode, setDevMode] = useState(false);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('dev_mode').then((v) => setDevMode(v === 'true'));
  }, []);

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
        // One-shot eviction of the legacy v1 cache (pre-#346); fire-and-forget.
        AsyncStorage.removeItem('team_profile_cache').catch(() => {});
        const cached = await AsyncStorage.getItem(TEAM_PROFILE_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as NostrProfile;
          if (!cancelled) {
            setTeamProfile(parsed);
            setTeamProfileLoading(false);
          }
        }
        const fetched = await fetchProfile(decoded.data, DEFAULT_RELAYS);
        if (!cancelled && fetched) {
          setTeamProfile(fetched);
          await AsyncStorage.setItem(TEAM_PROFILE_CACHE_KEY, JSON.stringify(fetched));
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

  const handleVersionTap = () => {
    versionTapCount.current += 1;
    if (versionTapTimer.current) clearTimeout(versionTapTimer.current);
    if (versionTapCount.current >= 3) {
      versionTapCount.current = 0;
      const newMode = !devMode;
      setDevMode(newMode);
      AsyncStorage.setItem('dev_mode', newMode ? 'true' : 'false');
      Alert.alert(
        newMode ? 'Developer Mode Enabled' : 'Developer Mode Disabled',
        newMode
          ? 'Dev features unlocked: hot wallet import in Add Wallet, "Following only" toggle on Messages and Groups tabs, and other in-app debug surfaces.'
          : 'Dev features hidden. Restart the app if any toggle still appears.',
      );
    } else {
      // Maestro tapOn cadence on Android emulator is ~400ms each, so 3 taps need >1s. Widen window in dev builds only.
      versionTapTimer.current = setTimeout(
        () => {
          versionTapCount.current = 0;
        },
        __DEV__ ? 3000 : 1000,
      );
    }
  };

  return (
    <AccountScreenLayout title="About">
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
                <Image
                  source={{ uri: teamProfile.picture }}
                  style={styles.teamPicture}
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
                  accessibilityLabel="Zap Lightning Piggy"
                  testID="zap-team-button"
                >
                  <Text style={styles.zapButtonText}>{'⚡'} Zap the Team</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.feedbackButton}
                onPress={() => setFeedbackSheetOpen(true)}
                accessibilityLabel="Send Feedback"
                testID="feedback-button"
              >
                <Text style={styles.feedbackButtonText}>Send Feedback</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <Text style={styles.teamFallbackText}>Could not load team profile</Text>
        )}
      </View>

      <View style={[sharedAccountStyles.card, { marginTop: 16 }]}>
        <Text style={styles.aboutTitle}>Lightning Piggy</Text>
        <Text style={styles.aboutBody}>
          A Lightning wallet + Nostr client built for families. Connect your wallets, message
          friends, and zap them over Lightning.
        </Text>
        <TouchableOpacity
          onPress={() => Linking.openURL('https://www.lightningpiggy.com')}
          accessibilityLabel="Open lightningpiggy.com"
          testID="about-website-link"
        >
          <Text style={styles.websiteLink}>www.lightningpiggy.com</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={handleVersionTap}
        activeOpacity={1}
        accessibilityLabel={`App version ${appVersion}`}
      >
        <Text style={styles.versionText} testID="version-text">
          v{appVersion}
          {devMode ? ' (dev)' : ''}
        </Text>
      </TouchableOpacity>

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

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    teamCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    teamBanner: {
      width: '100%',
      height: 80,
    },
    teamRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      gap: 12,
    },
    teamPicture: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 2,
      borderColor: colors.divider,
    },
    teamPicturePlaceholder: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    teamInfo: {
      flex: 1,
    },
    teamName: {
      color: colors.textHeader,
      fontSize: 16,
      fontWeight: '700',
    },
    teamAbout: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 2,
    },
    teamButtonRow: {
      paddingHorizontal: 16,
      paddingBottom: 16,
      gap: 8,
    },
    zapButton: {
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
      justifyContent: 'center',
      alignItems: 'center',
    },
    zapButtonText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '600',
    },
    feedbackButton: {
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: colors.brandPink,
    },
    feedbackButtonText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '600',
    },
    teamFallbackText: {
      color: colors.textSupplementary,
      fontSize: 14,
      padding: 20,
      textAlign: 'center',
    },
    aboutTitle: {
      color: colors.white,
      fontSize: 20,
      fontWeight: '700',
    },
    aboutBody: {
      color: colors.white,
      fontSize: 14,
      opacity: 0.9,
      lineHeight: 20,
    },
    websiteLink: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '600',
      textDecorationLine: 'underline',
      marginTop: 12,
    },
    versionText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '600',
      textAlign: 'center',
      paddingTop: 32,
    },
  });

export default AboutScreen;
