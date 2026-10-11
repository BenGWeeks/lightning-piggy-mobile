import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from './BrandedAlert';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import { createAboutScreenStyles } from '../styles/AboutScreen.styles';
import { createAdvancedScreenStyles } from '../styles/AdvancedScreen.styles';

const HermesProfilerSection: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createAboutScreenStyles(colors), [colors]);
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const advanced = useMemo(() => createAdvancedScreenStyles(colors), [colors]);
  // Hermes sampling profiler — gated on __DEV__ || EXPO_PUBLIC_KEEP_PERF_LOGS
  // so it never ships to production builds. Start writes samples in
  // memory; Stop & Share dumps a .cpuprofile + opens the OS share sheet
  // so the dev can save it to Files / airdrop it / drag-drop into Chrome
  // DevTools' Performance panel for the JS-thread flame graph. See
  // docs/PERFORMANCE.adoc for context. (#611 component 1.)
  const profilerAvailable = __DEV__ || (process.env.EXPO_PUBLIC_KEEP_PERF_LOGS ?? '') === '1';
  const [profilerRecording, setProfilerRecording] = useState(false);
  const [profilerBusy, setProfilerBusy] = useState(false);
  const handleProfilerStart = () => {
    const hermes = (
      globalThis as unknown as { HermesInternal?: { enableSamplingProfiler?: () => void } }
    ).HermesInternal;
    if (typeof hermes?.enableSamplingProfiler !== 'function') {
      Alert.alert(t('hermesProfiler.unavailableTitle'), t('hermesProfiler.unavailableBody'));
      return;
    }
    try {
      hermes.enableSamplingProfiler();
      setProfilerRecording(true);
    } catch (e) {
      Alert.alert(t('hermesProfiler.startError'), (e as Error).message);
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
        Alert.alert(t('hermesProfiler.emptyTitle'), t('hermesProfiler.emptyBody'));
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: t('hermesProfiler.shareTitle'),
          UTI: 'public.json',
        });
      } else {
        Alert.alert(
          t('hermesProfiler.saved'),
          t('hermesProfiler.savedBody', { size: info.size, path: filePath }),
        );
      }
    } catch (e) {
      Alert.alert(t('hermesProfiler.stopError'), (e as Error).message);
    } finally {
      setProfilerBusy(false);
    }
  };

  // Developer options only exist in dev / perf builds, header included.
  if (!profilerAvailable) return null;

  return (
    <View style={advanced.sectionGap} testID="advanced-developer-options">
      <Text style={sharedAccountStyles.sectionLabel}>{t('advancedScreen.developerOptions')}</Text>
      <View style={[sharedAccountStyles.card, advanced.devCard]} testID="hermes-profiler-card">
        <Text style={styles.aboutTitle}>{t('hermesProfiler.title')}</Text>
        <Text style={styles.aboutBody}>{t('hermesProfiler.hint')}</Text>
        <View style={styles.profilerRow}>
          <TouchableOpacity
            onPress={handleProfilerStart}
            disabled={profilerRecording || profilerBusy}
            style={[
              styles.profilerButton,
              (profilerRecording || profilerBusy) && styles.profilerButtonDisabled,
            ]}
            accessibilityLabel={t('hermesProfiler.startA11y')}
            testID="hermes-profiler-start"
          >
            <Text style={styles.profilerButtonText}>
              {profilerRecording ? t('hermesProfiler.recording') : t('hermesProfiler.start')}
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
            accessibilityLabel={t('hermesProfiler.stopA11y')}
            testID="hermes-profiler-stop"
          >
            {profilerBusy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={[styles.profilerButtonText, styles.profilerButtonTextPrimary]}>
                {t('hermesProfiler.stop')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};
export default HermesProfilerSection;
