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
import { Image as ExpoImage } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
// `expo-file-system/legacy` keeps the `cacheDirectory` string + `getInfoAsync`
// API. The v55 top-level module switched to the `Paths` / `File` class API;
// the legacy entry-point is the path of least resistance for a Hermes-profiler
// dump that just needs a string path to hand to Hermes' native API.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from '../../components/BrandedAlert';
import SecretModeCelebration from '../../components/SecretModeCelebration';
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
import { useGroups } from '../../contexts/GroupsContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import type { Palette } from '../../styles/palettes';
import type { NostrProfile } from '../../types/nostr';
import { LIGHTNING_PIGGY_TEAM_NPUB, dmRecipient } from '../../constants/npubs';
import { appVersionLabel } from '../../utils/appVersion';

// Bumped key (#346) to evict pre-avatar caches that pinned an empty avatar circle.
const TEAM_PROFILE_CACHE_KEY = 'team_profile_cache_v2';
const LEGACY_TEAM_PROFILE_CACHE_KEY = 'team_profile_cache';

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

  // Secret mode lives on GroupsContext so every consumer (Messages,
  // Groups, the Hunt WoT picker) sees the toggle in the same render
  // tick we flip it here. The triple-tap on the version label below
  // calls setSecretMode, which both updates context state AND
  // persists to AsyncStorage.
  const { secretMode, setSecretMode } = useGroups();
  // Drives the SecretModeCelebration overlay (confetti + card) on
  // each toggle. `pendingEnabled` carries which state was reached
  // when the overlay popped so the same component can render both
  // the enable and disable copy.
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState(false);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fold the unlocked-mode marker into the build-number parenthetical
  // so screen readers don't say "(build 13) (secret)" as a separate phrase.
  const displayVersionLabel = secretMode
    ? appVersionLabel.endsWith(')')
      ? `${appVersionLabel.slice(0, -1)}, secret)`
      : `${appVersionLabel} (secret)`
    : appVersionLabel;

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

  // Hermes sampling profiler — gated on __DEV__ || EXPO_PUBLIC_KEEP_PERF_LOGS
  // so it never ships to production builds. Start writes samples in
  // memory; Stop & Share dumps a .cpuprofile + opens the OS share sheet
  // so the dev can save it to Files / airdrop it / drag-drop into Chrome
  // DevTools' Performance panel for the JS-thread flame graph. See
  // docs/PERFORMANCE.adoc + .claude/agents/stevie.md for context. (#611
  // component 1.)
  const profilerAvailable = __DEV__ || (process.env.EXPO_PUBLIC_KEEP_PERF_LOGS ?? '') === '1';
  const [profilerRecording, setProfilerRecording] = useState(false);
  const [profilerBusy, setProfilerBusy] = useState(false);
  const handleProfilerStart = () => {
    const hermes = (
      globalThis as unknown as { HermesInternal?: { enableSamplingProfiler?: () => void } }
    ).HermesInternal;
    if (typeof hermes?.enableSamplingProfiler !== 'function') {
      Alert.alert(
        'Hermes profiler unavailable',
        'This build does not expose the Hermes sampling profiler. Rebuild with Hermes enabled.',
      );
      return;
    }
    try {
      hermes.enableSamplingProfiler();
      setProfilerRecording(true);
    } catch (e) {
      Alert.alert('Could not start profiler', (e as Error).message);
    }
  };
  const handleProfilerStopAndShare = async () => {
    const hermes = (
      globalThis as unknown as {
        HermesInternal?: {
          dumpSampledTraceToFile?: (path: string) => void;
          disableSamplingProfiler?: () => void;
        };
      }
    ).HermesInternal;
    setProfilerBusy(true);
    try {
      const cacheDir = FileSystem.cacheDirectory ?? '';
      const fileUri = `${cacheDir}hermes-profile-${Date.now()}.cpuprofile`;
      // Hermes' native API expects a POSIX path, not a `file://` URI.
      const filePath = fileUri.replace(/^file:\/\//, '');
      if (typeof hermes?.dumpSampledTraceToFile === 'function') {
        hermes.dumpSampledTraceToFile(filePath);
      }
      // Disable after dump to free sampler buffers; some Hermes builds
      // expose only `disableSamplingProfiler(filename?)` which both
      // stops and dumps. Try both surfaces defensively.
      if (typeof hermes?.disableSamplingProfiler === 'function') {
        try {
          hermes.disableSamplingProfiler();
        } catch {
          // Some Hermes builds throw if called without a profile-in-flight.
        }
      }
      setProfilerRecording(false);
      // Verify the file landed before sharing — Hermes can no-op silently.
      const info = await FileSystem.getInfoAsync(fileUri);
      if (!info.exists || (info.size ?? 0) === 0) {
        Alert.alert(
          'Profile is empty',
          'No samples were captured. Make sure Hermes is the active JS engine and the app did real work during the recording window.',
        );
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: 'Save Hermes .cpuprofile',
          UTI: 'public.json',
        });
      } else {
        Alert.alert('Profile saved', `Wrote ${info.size} B to ${filePath}`);
      }
    } catch (e) {
      Alert.alert('Could not stop profiler', (e as Error).message);
    } finally {
      setProfilerBusy(false);
    }
  };

  const handleVersionTap = () => {
    versionTapCount.current += 1;
    if (versionTapTimer.current) clearTimeout(versionTapTimer.current);
    if (versionTapCount.current >= 3) {
      versionTapCount.current = 0;
      // setSecretMode lives on GroupsContext — it persists to
      // AsyncStorage AND notifies every other consumer in the same
      // tick, so the WoT picker, Messages tab and Groups tab unlock
      // their secret-mode surfaces right away rather than waiting for
      // a full restart. The celebration overlay replaces the previous
      // Alert.alert reveal — confetti for enable, plain card for
      // disable (the SecretModeCelebration component branches on
      // `enabled`).
      const newMode = !secretMode;
      setSecretMode(newMode);
      setPendingEnabled(newMode);
      setCelebrationVisible(true);
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

      {profilerAvailable && (
        <View style={[sharedAccountStyles.card, { marginTop: 16 }]} testID="hermes-profiler-card">
          <Text style={styles.aboutTitle}>Performance profiler (dev)</Text>
          <Text style={styles.aboutBody}>
            Captures a Hermes JS-thread sampling profile. Start, reproduce the slow scenario, then
            Stop & Share to save the .cpuprofile. Open it in Chrome DevTools → Performance → Load
            profile for a flame graph.
          </Text>
          <View style={styles.profilerRow}>
            <TouchableOpacity
              onPress={handleProfilerStart}
              disabled={profilerRecording || profilerBusy}
              style={[
                styles.profilerButton,
                (profilerRecording || profilerBusy) && styles.profilerButtonDisabled,
              ]}
              accessibilityLabel="Start Hermes sampling profiler"
              testID="hermes-profiler-start"
            >
              <Text style={styles.profilerButtonText}>
                {profilerRecording ? 'Recording…' : 'Start'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleProfilerStopAndShare}
              disabled={!profilerRecording || profilerBusy}
              style={[
                styles.profilerButton,
                styles.profilerButtonPrimary,
                (!profilerRecording || profilerBusy) && styles.profilerButtonDisabled,
              ]}
              accessibilityLabel="Stop Hermes profiler and share .cpuprofile"
              testID="hermes-profiler-stop"
            >
              {profilerBusy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={[styles.profilerButtonText, styles.profilerButtonTextPrimary]}>
                  Stop &amp; Share
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <TouchableOpacity
        onPress={handleVersionTap}
        activeOpacity={1}
        accessibilityLabel={`App version ${displayVersionLabel}`}
      >
        <Text style={styles.versionText} testID="version-text">
          v{displayVersionLabel}
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

      <SecretModeCelebration
        visible={celebrationVisible}
        enabled={pendingEnabled}
        onDismiss={() => setCelebrationVisible(false)}
      />
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
    profilerRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 12,
    },
    profilerButton: {
      flex: 1,
      backgroundColor: 'rgba(255,255,255,0.15)',
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profilerButtonPrimary: {
      backgroundColor: colors.brandPink,
    },
    profilerButtonDisabled: {
      opacity: 0.45,
    },
    profilerButtonText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '600',
    },
    profilerButtonTextPrimary: {
      color: colors.white,
    },
  });

export default AboutScreen;
