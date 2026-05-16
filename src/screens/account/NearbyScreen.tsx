import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { Alert } from '../../components/BrandedAlert';
import { useThemeColors } from '../../contexts/ThemeContext';
import type { Palette } from '../../styles/palettes';
import {
  DEFAULT_NEARBY_SETTINGS,
  loadNearbySettings,
  saveNearbySettings,
  type NearbySettings,
} from '../../services/nearbySettingsService';
import {
  disableGeofencing,
  enableGeofencing,
  isGeofencingActive,
} from '../../services/geofenceService';

const RADIUS_PRESETS: NearbySettings['alertRadiusMeters'][] = [50, 100, 250, 500];

const NearbyScreen: React.FC = () => {
  const colors = useThemeColors();
  const sharedStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [settings, setSettings] = useState<NearbySettings>(DEFAULT_NEARBY_SETTINGS);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);

  // Load + reflect current state on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadNearbySettings();
      const a = await isGeofencingActive();
      if (!cancelled) {
        setSettings(s);
        setActive(a);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: NearbySettings) => {
    setSettings(next);
    await saveNearbySettings(next);
  }, []);

  const handleToggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (settings.enabled) {
        await disableGeofencing();
        await persist({ ...settings, enabled: false });
        setActive(false);
        return;
      }

      // Enabling — request both permissions, then start the task.
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        Alert.alert(
          'Location permission required',
          'Granting "While in use" location is the first step before we can ask for "Always".',
          [{ text: 'OK' }],
        );
        return;
      }
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== 'granted') {
        Alert.alert(
          'Background location required',
          'Without "Always" location, we can\'t alert you near merchants while the app is in your pocket. Open Settings to enable it, or leave this feature off.',
          [{ text: 'OK' }],
        );
        return;
      }
      const notif = await Notifications.requestPermissionsAsync();
      if (notif.status !== 'granted') {
        Alert.alert(
          'Notifications required',
          'Geofence alerts need notification permission so we can tell you when you walk past a merchant.',
          [{ text: 'OK' }],
        );
        return;
      }

      const count = await enableGeofencing();
      if (count === null) {
        // No merchants around right now — don't claim the feature is "on" when
        // no geofence task is actually running (Copilot review #488). The user
        // can re-toggle once they move into an area with merchants; we don't
        // run a background recompute loop yet (that's M3-followup work). Keep
        // the persisted preference at OFF so isGeofencingActive() / the toggle
        // visual stay honest.
        Alert.alert(
          'No nearby merchants',
          "We couldn't find any Bitcoin-accepting merchants near your current location. Move closer to a city centre and toggle this on again.",
          [{ text: 'OK' }],
        );
        await persist({ ...settings, enabled: false });
        setActive(false);
        return;
      }
      await persist({ ...settings, enabled: true });
      setActive(true);
    } catch (e) {
      Alert.alert('Could not enable', (e as Error).message, [{ text: 'OK' }]);
    } finally {
      setBusy(false);
    }
  }, [busy, settings, persist]);

  const handleRadius = useCallback(
    async (m: NearbySettings['alertRadiusMeters']) => {
      await persist({ ...settings, alertRadiusMeters: m });
      // If geofencing is currently active, recompute regions with the new
      // radius so the change takes effect immediately rather than after the
      // next user move.
      if (settings.enabled) {
        try {
          await enableGeofencing();
        } catch {
          // Non-fatal — UI stays consistent and the next foreground re-init
          // will re-register with the new radius.
        }
      }
    },
    [settings, persist],
  );

  const handleQuietHours = useCallback(
    async () => persist({ ...settings, quietHoursEnabled: !settings.quietHoursEnabled }),
    [settings, persist],
  );

  const Toggle: React.FC<{ on: boolean; onPress: () => void; testID: string; label: string }> = ({
    on,
    onPress,
    testID,
    label,
  }) => (
    <TouchableOpacity
      style={[sharedStyles.sslToggle, on && sharedStyles.sslToggleActive]}
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={[sharedStyles.sslToggleThumb, on && sharedStyles.sslToggleThumbActive]} />
    </TouchableOpacity>
  );

  return (
    <AccountScreenLayout title="Nearby merchants">
      <View style={sharedStyles.card}>
        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>Alert me near Bitcoin shops</Text>
            <Text style={styles.rowSub}>
              {active
                ? "Geofencing is on — we'll alert you when you walk near a merchant."
                : 'Off. Turn this on to opt in to background-location alerts.'}
            </Text>
          </View>
          <Toggle
            on={settings.enabled}
            onPress={handleToggle}
            testID="settings-nearby-merchants-toggle"
            label="Enable nearby merchant alerts"
          />
        </View>
      </View>

      <Text style={[sharedStyles.sectionLabel, styles.sectionGap]}>Alert radius</Text>
      <View style={styles.chipRow}>
        {RADIUS_PRESETS.map((m) => {
          const selected = settings.alertRadiusMeters === m;
          return (
            <TouchableOpacity
              key={m}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => handleRadius(m)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`settings-alert-radius-${m}`}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{m} m</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[sharedStyles.sectionLabel, styles.sectionGap]}>Quiet hours</Text>
      <View style={sharedStyles.card}>
        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>22:00 – 08:00 (local time)</Text>
            <Text style={styles.rowSub}>
              No alerts during the window even when you walk past a merchant.
            </Text>
          </View>
          <Toggle
            on={settings.quietHoursEnabled}
            onPress={handleQuietHours}
            testID="settings-quiet-hours-toggle"
            label="Quiet hours"
          />
        </View>
      </View>

      <Text style={styles.privacyHint}>
        Geofences run on your device. Your live location never leaves your phone — we only send a
        coarse bounding box (≈ 2 km) to BTC Map at most every 500 m of movement.
      </Text>
    </AccountScreenLayout>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    rowMain: {
      flex: 1,
    },
    rowTitle: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    rowSub: {
      color: 'rgba(255,255,255,0.75)',
      fontSize: 13,
      marginTop: 2,
    },
    sectionGap: {
      marginTop: 24,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 100,
      backgroundColor: 'rgba(255,255,255,0.15)',
    },
    chipSelected: {
      backgroundColor: colors.surface,
    },
    chipText: {
      color: colors.white,
      fontWeight: '700',
      fontSize: 13,
    },
    chipTextSelected: {
      color: colors.brandPink,
    },
    privacyHint: {
      marginTop: 24,
      color: 'rgba(255,255,255,0.7)',
      fontSize: 12,
      lineHeight: 18,
    },
  });

export default NearbyScreen;
