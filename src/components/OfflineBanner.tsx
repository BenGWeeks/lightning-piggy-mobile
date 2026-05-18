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
      accessibilityLabel="You're offline. Some data may be stale."
      testID="offline-banner"
    >
      <Text style={styles.text} numberOfLines={1}>
        You&apos;re offline — some data may be stale
      </Text>
    </View>
  );
};

export default OfflineBanner;

const createStyles = (colors: Palette, topInset: number) =>
  StyleSheet.create<{ container: ViewStyle; text: TextStyle }>({
    container: {
      // Sits below the system status bar (notch / camera cutout). The
      // safe-area inset is added to a 28dp content height so the banner
      // never collides with the status icons.
      paddingTop: topInset,
      backgroundColor: colors.brandPink,
      paddingHorizontal: 16,
      paddingBottom: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 18,
    },
  });
