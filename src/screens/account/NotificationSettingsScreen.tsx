import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { BellRing, Radio } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { useTranslation } from '../../contexts/LocaleContext';
import MutedAccountsList from '../../components/MutedAccountsList';
import MarmotPushSection from '../../components/MarmotPushSection';
import SettingsScopeHeader from '../../components/SettingsScopeHeader';
import NotificationPermissionRow from '../../components/NotificationPermissionRow';
import ShopAlertsSection from '../../components/ShopAlertsSection';
import SettingsRow from '../../components/SettingsRow';
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
 * Settings → Notifications: every notification setting in one place. The
 * system permission comes first because every alert below depends on it;
 * the rest is split by where it's stored. "For this account" follows the
 * signed-in account (push registrations are per account); "On this phone"
 * applies to every account on the device (lock-screen content, the Android
 * background watch and the shop geofences). The notification server is
 * phone-wide too, but rarely touched, so it lives under Settings → Advanced.
 */
const NotificationSettingsScreen: React.FC = () => {
  const t = useTranslation();
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
    <AccountScreenLayout title={t('notificationSettingsScreen.title')} scrollable={false}>
      <MutedAccountsList
        header={
          <>
            <NotificationPermissionRow />

            <SettingsScopeHeader scope="account" testID="notifications-account" />
            <MarmotPushSection />

            <SettingsScopeHeader scope="phone" spaced testID="notifications-phone" />

            <SettingsRow
              icon={BellRing}
              title={t('securityScreen.showMessagePaymentDetails')}
              subtitle={t('settingsRows.notificationContentSubtitle')}
              testID="notifications-content"
              details={t('securityScreen.notificationContentHint')}
              toggle={{
                value: lockScreenContentOn,
                onValueChange: handleToggleLockScreenContent,
                accessibilityLabel: t('securityScreen.showMessagePaymentDetailsA11y'),
                testID: 'security-lockscreen-content-toggle',
              }}
            />
            {isAndroid && (
              <SettingsRow
                icon={Radio}
                title={t('securityScreen.watchForMessages')}
                subtitle={t('settingsRows.backgroundSubtitle')}
                testID="notifications-background"
                infoTestID="security-background-dm-details"
                details={[
                  t('securityScreen.backgroundNotificationsHint'),
                  t('securityScreen.backgroundDetailsNoGoogle'),
                  t('securityScreen.backgroundDetailsBattery'),
                  t('securityScreen.backgroundDetailsPayments'),
                ].join('\n\n')}
                toggle={{
                  value: backgroundDmOn,
                  onValueChange: handleToggleBackgroundDm,
                  testID: 'security-background-dm-toggle',
                }}
              />
            )}

            <ShopAlertsSection />
          </>
        }
      />
    </AccountScreenLayout>
  );
};

export default NotificationSettingsScreen;
