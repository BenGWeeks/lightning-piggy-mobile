import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, View, Text, TouchableOpacity } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { MapPin, Moon, Radius } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import Toast from './BrandedToast';
import { useOptimisticSwitch } from '../hooks/useOptimisticSwitch';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import SettingsRow from './SettingsRow';
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
  const styles = useMemo(() => createShopAlertsSectionStyles(colors), [colors]);

  const [settings, setSettings] = useState<NearbySettings>(DEFAULT_NEARBY_SETTINGS);
  const [active, setActive] = useState(false);
  const [locationAvailable, setLocationAvailable] = useState(true);
  const reportFailure = () =>
    Toast.show({ type: 'error', text1: t('notificationSettingsScreen.updateFailed') });
  const master = useOptimisticSwitch(
    settings.enabled,
    (enabled) => setSettings((current) => ({ ...current, enabled })),
    reportFailure,
  );
  const quietHours = useOptimisticSwitch(
    settings.quietHoursEnabled,
    (quietHoursEnabled) => setSettings((current) => ({ ...current, quietHoursEnabled })),
    reportFailure,
  );

  // Load + reflect current state on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadNearbySettings();
      const a = await isGeofencingActive();
      const available = await Location.hasServicesEnabledAsync().catch(() => true);
      if (!cancelled) {
        setSettings(s);
        setActive(a);
        setLocationAvailable(available);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const refresh = () => {
        void Location.hasServicesEnabledAsync()
          .then((available) => {
            if (alive) setLocationAvailable(available);
          })
          .catch(() => undefined);
      };
      refresh();
      const subscription = AppState.addEventListener('change', (state) => {
        if (timer) clearTimeout(timer);
        if (state === 'active') timer = setTimeout(refresh, 3000);
      });
      return () => {
        alive = false;
        if (timer) clearTimeout(timer);
        subscription.remove();
      };
    }, []),
  );

  const persist = useCallback(async (next: NearbySettings, reportFailure = false) => {
    setSettings(next);
    await saveNearbySettings(next, reportFailure);
  }, []);

  const handleToggle = (next: boolean) =>
    master.run(next, async () => {
      const fail = (key: string) => {
        Toast.show({ type: 'error', text1: t(key) });
        return false;
      };
      const persistMaster = async () => {
        try {
          await persist({ ...settings, enabled: next }, true);
        } catch (error) {
          // Registration changes precede persistence. Restore the previous
          // native state before the optimistic switch rolls back and toasts.
          await (active ? enableGeofencing() : disableGeofencing()).catch(() => undefined);
          setActive(await isGeofencingActive());
          throw error;
        }
      };
      if (!next) {
        await disableGeofencing();
        await persistMaster();
        setActive(false);
        return;
      }
      // Permissions and merchant registration stay in the original order.
      const available = await Location.hasServicesEnabledAsync();
      setLocationAvailable(available);
      if (!available) return fail('notificationSettingsScreen.locationUnavailable');
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') return fail('shopAlerts.locationPermissionTitle');
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== 'granted') return fail('shopAlerts.backgroundLocationTitle');
      const notif = await Notifications.requestPermissionsAsync();
      if (notif.status !== 'granted') return fail('shopAlerts.notificationsTitle');

      const count = await enableGeofencing();
      if (count === null) return fail('shopAlerts.noNearbyMerchantsTitle');
      await persistMaster();
      setActive(true);
    });

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

  const handleQuietHours = (next: boolean) =>
    master.pending
      ? Promise.resolve()
      : quietHours.run(next, () =>
          saveNearbySettings({ ...settings, quietHoursEnabled: next }, true),
        );

  return (
    <View style={styles.card} testID="notifications-shop-alerts">
      <SettingsRow
        grouped
        icon={MapPin}
        title={t('shopAlerts.alertMeNearShops')}
        subtitle={
          !locationAvailable
            ? t('notificationSettingsScreen.locationUnavailable')
            : t(active ? 'notificationSettingsScreen.on' : 'notificationSettingsScreen.off')
        }
        testID="shop-alerts-enabled"
        details={t('shopAlerts.privacyHint')}
        infoTestID="shop-alerts-privacy"
        toggle={{
          value: settings.enabled,
          onValueChange: handleToggle,
          pending: master.pending || quietHours.pending,
          disabled: !locationAvailable && !settings.enabled,
          accessibilityLabel: t('shopAlerts.enableAlertsLabel'),
          testID: 'settings-nearby-merchants-toggle',
        }}
      />
      <SettingsRow
        grouped
        icon={Radius}
        title={t('shopAlerts.alertRadius')}
        subtitle={t('shopAlerts.radiusMeters', { meters: settings.alertRadiusMeters })}
        testID="shop-alerts-radius"
      />
      <View style={styles.chipRow}>
        {RADIUS_PRESETS.map((m) => {
          const selected = settings.alertRadiusMeters === m;
          return (
            <TouchableOpacity
              key={m}
              style={[styles.chip, selected && styles.chipSelected]}
              disabled={master.pending || quietHours.pending}
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

      <SettingsRow
        grouped
        icon={Moon}
        title={t('shopAlerts.quietHours')}
        subtitle={
          settings.quietHoursEnabled
            ? t('shopAlerts.quietHoursWindow')
            : t('notificationSettingsScreen.off')
        }
        testID="shop-alerts-quiet-hours"
        details={t('shopAlerts.quietHoursSub')}
        toggle={{
          value: settings.quietHoursEnabled,
          pending: quietHours.pending,
          accessibilityLabel: t('shopAlerts.quietHours'),
          onValueChange: handleQuietHours,
          testID: 'settings-quiet-hours-toggle',
        }}
      />
      <Text style={styles.privacyHint}>{t('notificationSettingsScreen.shopConsequence')}</Text>
    </View>
  );
};

export default ShopAlertsSection;
