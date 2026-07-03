// Persistent top-of-screen banner shown only when the device has no
// internet connectivity. Single canonical signal for the user — wallet
// balance refreshes / fiat-rate / Nostr / BTC Map all stall together
// when offline, and the banner explains why so the app doesn't read as
// silently broken (#634).

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';

// Treat a connectivity state as "offline" only when NetInfo is *certain*
// it isn't connected. `isConnected === null` is the unknown-state during
// the first probe on cold start — we don't want the banner to flash on
// during launch before NetInfo has even checked the radio. `false` is
// the definite-offline branch. The reachability check (`isInternetReachable`)
// is intentionally NOT factored in: false-negatives on captive-portal
// networks are common, and the user already gets stale-data UX in that
// case from the per-surface fallbacks.
function isDefinitelyOffline(state: NetInfoState | null): boolean {
  return state?.isConnected === false;
}

const OfflineBanner: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, insets.top), [colors, insets.top]);
  const [state, setState] = useState<NetInfoState | null>(null);

  useEffect(() => {
    // Seed from a one-shot fetch then keep updating via the listener.
    // Without the seed the banner doesn't paint until the first
    // connectivity change, so a user who launches the app while already
    // offline would never see it.
    NetInfo.fetch()
      .then(setState)
      .catch(() => {});
    const unsubscribe = NetInfo.addEventListener(setState);
    return unsubscribe;
  }, []);

  if (!isDefinitelyOffline(state)) return null;

  return (
    <View
      style={styles.container}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('offlineBanner.a11yLabel')}
      testID="offline-banner"
    >
      <Text style={styles.text} numberOfLines={1}>
        {t('offlineBanner.bannerText')}
      </Text>
    </View>
  );
};

export default OfflineBanner;

const createStyles = (colors: Palette, topInset: number) =>
  StyleSheet.create<{ container: ViewStyle; text: TextStyle }>({
    container: {
      // Sits below the system status bar (notch / camera cutout): the
      // safe-area inset clears the status icons, then the bar hugs the
      // text with a hairline of breathing room above and below.
      paddingTop: topInset + 3,
      paddingBottom: 3,
      // The screen below applies its OWN top safe-area inset, so without
      // this the status-bar gap is reserved twice and the page drops by
      // an extra `topInset` it doesn't need (#634 review). Cancel our
      // share of that inset with a negative margin — the bar still paints
      // over the status bar, but only its text height adds to the layout.
      // zIndex/elevation keep it above the content it now overlaps.
      marginBottom: -topInset,
      zIndex: 10,
      elevation: 10,
      backgroundColor: colors.brandPurple,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 16,
    },
  });
