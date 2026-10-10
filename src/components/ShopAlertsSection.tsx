import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Switch } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { MapPin } from 'lucide-react-native';
import { Alert } from './BrandedAlert';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import { createSecurityScreenStyles } from '../styles/SecurityScreen.styles';
import { createShopAlertsSectionStyles } from '../styles/ShopAlertsSection.styles';
import {
  DEFAULT_NEARBY_SETTINGS,
  loadNearbySettings,
  saveNearbySettings,
  type NearbySettings,
} from '../services/nearbySettingsService';
import {
  disableGeofencing,
  enableGeofencing,
  isGeofencingActive,
} from '../services/geofenceService';

const RADIUS_PRESETS: NearbySettings['alertRadiusMeters'][] = [50, 100, 250, 500];

/**
 * Settings → Notifications → On this phone: "Alerts near Bitcoin shops"
 * (geofence alerts, #467) with its radius and quiet hours. Device-wide —
 * the geofence task belongs to the phone, not to an account.
 */
const ShopAlertsSection: React.FC = () => {
  const t = useTranslation();
  const colors = useThemeColors();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const screen = useMemo(() => createSecurityScreenStyles(colors), [colors]);
  const styles = useMemo(() => createShopAlertsSectionStyles(colors), [colors]);

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
          t('shopAlerts.locationPermissionTitle'),
          t('shopAlerts.locationPermissionMessage'),
          [{ text: t('shopAlerts.ok') }],
        );
        return;
      }
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== 'granted') {
        Alert.alert(
          t('shopAlerts.backgroundLocationTitle'),
          t('shopAlerts.backgroundLocationMessage'),
          [{ text: t('shopAlerts.ok') }],
        );
        return;
      }
      const notif = await Notifications.requestPermissionsAsync();
      if (notif.status !== 'granted') {
        Alert.alert(t('shopAlerts.notificationsTitle'), t('shopAlerts.notificationsMessage'), [
          { text: t('shopAlerts.ok') },
        ]);
        return;
      }

      const count = await enableGeofencing();
      if (count === null) {
        // No merchants around right now — don't claim the feature is "on" when
        // no geofence task is actually running (Copilot review #488). The user
        // can re-toggle once they move into an area with merchants. Keep the
        // persisted preference at OFF so isGeofencingActive() / the toggle
        // visual stay honest.
        Alert.alert(
          t('shopAlerts.noNearbyMerchantsTitle'),
          t('shopAlerts.noNearbyMerchantsMessage'),
          [{ text: t('shopAlerts.ok') }],
        );
        await persist({ ...settings, enabled: false });
        setActive(false);
        return;
      }
      await persist({ ...settings, enabled: true });
      setActive(true);
    } catch (e) {
      Alert.alert(t('shopAlerts.couldNotEnableTitle'), (e as Error).message, [
        { text: t('shopAlerts.ok') },
      ]);
    } finally {
      setBusy(false);
    }
  }, [busy, settings, persist, t]);

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
          // Non-fatal — the next foreground re-init re-registers with the new radius.
        }
      }
    },
    [settings, persist],
  );

  const handleQuietHours = useCallback(
    async () => persist({ ...settings, quietHoursEnabled: !settings.quietHoursEnabled }),
    [settings, persist],
  );

  return (
    <View testID="notifications-shop-alerts">
      <View style={[screen.headerRow, screen.sectionGap]}>
        <MapPin size={22} color={colors.white} />
        <Text style={[shared.sectionLabel, screen.headerLabel]}>{t('shopAlerts.title')}</Text>
      </View>
      <Text style={shared.fieldHint}>
        {active ? t('shopAlerts.geofencingOn') : t('shopAlerts.geofencingOff')}
      </Text>
      <View style={screen.toggleRow}>
        <Text style={[screen.optionLabel, screen.toggleLabel]}>
          {t('shopAlerts.alertMeNearShops')}
        </Text>
        <Switch
          value={settings.enabled}
          onValueChange={handleToggle}
          disabled={busy}
          accessibilityLabel={t('shopAlerts.enableAlertsLabel')}
          testID="settings-nearby-merchants-toggle"
          trackColor={{ false: colors.divider, true: colors.brandPink }}
          thumbColor={settings.enabled ? colors.white : undefined}
        />
      </View>

      <Text style={styles.subHeader}>{t('shopAlerts.alertRadius')}</Text>
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
              accessibilityLabel={t('shopAlerts.radiusMeters', { meters: m })}
              testID={`settings-alert-radius-${m}`}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {t('shopAlerts.radiusMeters', { meters: m })}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.subHeader}>{t('shopAlerts.quietHours')}</Text>
      <View style={[screen.toggleRow, styles.flushTop]}>
        <View style={screen.toggleLabel}>
          <Text style={screen.optionLabel}>{t('shopAlerts.quietHoursWindow')}</Text>
          <Text style={styles.optionSublabel}>{t('shopAlerts.quietHoursSub')}</Text>
        </View>
        <Switch
          value={settings.quietHoursEnabled}
          onValueChange={handleQuietHours}
          accessibilityLabel={t('shopAlerts.quietHours')}
          testID="settings-quiet-hours-toggle"
          trackColor={{ false: colors.divider, true: colors.brandPink }}
          thumbColor={settings.quietHoursEnabled ? colors.white : undefined}
        />
      </View>

      <Text style={styles.privacyHint}>{t('shopAlerts.privacyHint')}</Text>
    </View>
  );
};

export default ShopAlertsSection;
