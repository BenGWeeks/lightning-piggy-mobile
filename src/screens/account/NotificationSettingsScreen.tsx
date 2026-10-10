import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Switch, Platform } from 'react-native';
import { BellRing, Radio } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { createSecurityScreenStyles } from '../../styles/SecurityScreen.styles';
import MarmotPushSection from '../../components/MarmotPushSection';
import SettingsScopeHeader from '../../components/SettingsScopeHeader';
import NotificationPermissionRow from '../../components/NotificationPermissionRow';
import ShopAlertsSection from '../../components/ShopAlertsSection';
import DetailsDisclosure from '../../components/DetailsDisclosure';
import {
  getLockScreenContentEnabled,
  setLockScreenContentEnabled,
  requestNotificationPermission,
} from '../../services/notificationService';
import {
  loadBackgroundDmEnabled,
  setBackgroundDmEnabled,
} from '../../services/backgroundDmPreference';
import { startBackgroundDmWatch, stopBackgroundDmWatch } from '../../services/backgroundDmService';

/**
 * Settings → Notifications: every notification setting in one place, split
 * by where it's stored. "For this account" follows the signed-in account
 * (push registrations are per account); "On this phone" applies to every
 * account on the device (system permission, lock-screen content, the
 * Android background watch and the shop geofences).
 */
const NotificationSettingsScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const screen = useMemo(() => createSecurityScreenStyles(colors), [colors]);
  const [lockScreenContentOn, setLockScreenContentOn] = useState<boolean>(false);
  // Background DM watch is Android-only (iOS can't hold a background socket).
  const [backgroundDmOn, setBackgroundDmOn] = useState<boolean>(false);
  const isAndroid = Platform.OS === 'android';

  useEffect(() => {
    getLockScreenContentEnabled().then(setLockScreenContentOn);
    if (isAndroid) loadBackgroundDmEnabled().then(setBackgroundDmOn);
  }, [isAndroid]);

  const handleToggleLockScreenContent = async (next: boolean) => {
    setLockScreenContentOn(next);
    await setLockScreenContentEnabled(next);
  };

  const handleToggleBackgroundDm = async (next: boolean) => {
    if (next) {
      // Turning ON needs notification permission for the persistent chip +
      // per-message alerts. If the user denies, leave the toggle off rather
      // than running a watch that can never surface anything.
      const granted = await requestNotificationPermission();
      if (!granted) {
        setBackgroundDmOn(false);
        return;
      }
      setBackgroundDmOn(true);
      await setBackgroundDmEnabled(true);
      await startBackgroundDmWatch();
    } else {
      setBackgroundDmOn(false);
      await setBackgroundDmEnabled(false);
      await stopBackgroundDmWatch();
    }
  };

  return (
    <AccountScreenLayout title={t('notificationSettingsScreen.title')}>
      <SettingsScopeHeader scope="account" testID="notifications-account" />
      <MarmotPushSection />

      <SettingsScopeHeader scope="phone" spaced testID="notifications-phone" />
      <NotificationPermissionRow />

      <View style={[screen.headerRow, screen.sectionGap]}>
        <BellRing size={22} color={colors.white} />
        <Text style={[shared.sectionLabel, screen.headerLabel]}>
          {t('securityScreen.notificationContent')}
        </Text>
      </View>
      <Text style={shared.fieldHint}>{t('securityScreen.notificationContentHint')}</Text>
      <View style={screen.toggleRow}>
        <Text style={[screen.optionLabel, screen.toggleLabel]}>
          {t('securityScreen.showMessagePaymentDetails')}
        </Text>
        <Switch
          value={lockScreenContentOn}
          onValueChange={handleToggleLockScreenContent}
          accessibilityLabel={t('securityScreen.showMessagePaymentDetailsA11y')}
          testID="security-lockscreen-content-toggle"
          trackColor={{ false: colors.divider, true: colors.brandPink }}
          thumbColor={lockScreenContentOn ? colors.white : undefined}
        />
      </View>

      {isAndroid && (
        <>
          <View style={[screen.headerRow, screen.sectionGap]}>
            <Radio size={22} color={colors.white} />
            <Text style={[shared.sectionLabel, screen.headerLabel]}>
              {t('securityScreen.backgroundNotifications')}
            </Text>
          </View>
          <Text style={shared.fieldHint}>{t('securityScreen.backgroundNotificationsHint')}</Text>
          <DetailsDisclosure
            label={t('securityScreen.details')}
            testID="security-background-dm-details"
            paragraphs={[
              t('securityScreen.backgroundDetailsNoGoogle'),
              t('securityScreen.backgroundDetailsBattery'),
              t('securityScreen.backgroundDetailsPayments'),
            ]}
          />
          <View style={screen.toggleRow}>
            <Text style={[screen.optionLabel, screen.toggleLabel]}>
              {t('securityScreen.watchForMessages')}
            </Text>
            <Switch
              value={backgroundDmOn}
              onValueChange={handleToggleBackgroundDm}
              accessibilityLabel={t('securityScreen.watchForMessages')}
              testID="security-background-dm-toggle"
              trackColor={{ false: colors.divider, true: colors.brandPink }}
              thumbColor={backgroundDmOn ? colors.white : undefined}
            />
          </View>
        </>
      )}

      <ShopAlertsSection />
    </AccountScreenLayout>
  );
};

export default NotificationSettingsScreen;
