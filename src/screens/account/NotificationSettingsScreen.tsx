import React, { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { BellRing, Radio, MapPin, Server, BellOff } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { useTranslation } from '../../contexts/LocaleContext';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { AccountDrawerNavigation } from '../../navigation/types';
import { useMutedSenders } from '../../hooks/useMutedSenders';
import { useNostr } from '../../contexts/NostrContext';
import { loadMarmotPushSettings } from '../../services/marmotPushRegistration';
import { loadNearbySettings } from '../../services/nearbySettingsService';
import MarmotPushSection from '../../components/MarmotPushSection';
import SettingsSection from '../../components/SettingsSection';
import NotificationPermissionRow from '../../components/NotificationPermissionRow';
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

const NotificationSettingsScreen: React.FC = () => {
  const t = useTranslation();
  const navigation = useNavigation<AccountDrawerNavigation>();
  const { mutedSenders } = useMutedSenders();
  const { pubkey } = useNostr();
  const [shopOn, setShopOn] = useState(false);
  const [customServer, setCustomServer] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadNearbySettings().then((s) => {
        if (alive) setShopOn(s.enabled);
      });
      if (pubkey)
        void loadMarmotPushSettings(pubkey)
          .then((s) => {
            if (alive) setCustomServer(!!s.customServer);
          })
          .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, [pubkey]),
  );
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
      <NotificationPermissionRow />

      <SettingsSection scope="account" testID="notifications-account">
        <MarmotPushSection />

        <SettingsRow
          icon={BellOff}
          title={t('notificationMute.accounts')}
          subtitle={t('notificationSettingsScreen.mutedCount', { count: mutedSenders.size })}
          testID="notifications-muted-accounts"
          onPress={() => navigation.navigate('AccountMutedAccounts')}
        />
      </SettingsSection>
      <SettingsSection scope="phone" testID="notifications-phone">
        <SettingsRow
          icon={BellRing}
          title={t('notificationSettingsScreen.showDetails')}
          subtitle={t(
            lockScreenContentOn
              ? 'notificationSettingsScreen.detailsOn'
              : 'notificationSettingsScreen.detailsOff',
          )}
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
            title={t('notificationSettingsScreen.checkClosed')}
            subtitle={t(
              backgroundDmOn ? 'notificationSettingsScreen.on' : 'notificationSettingsScreen.off',
            )}
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

        <SettingsRow
          icon={MapPin}
          title={t('shopAlerts.title')}
          subtitle={t(shopOn ? 'notificationSettingsScreen.on' : 'notificationSettingsScreen.off')}
          testID="notifications-shop-alerts"
          onPress={() => navigation.navigate('AccountShopAlerts')}
        />
        <SettingsRow
          icon={Server}
          title={t('securityScreen.marmotPushServerTitle')}
          details={t('securityScreen.marmotPushServerHint')}
          subtitle={t(
            customServer
              ? 'notificationSettingsScreen.customServer'
              : 'notificationSettingsScreen.defaultServer',
          )}
          testID="notifications-notification-server"
          onPress={() => navigation.navigate('AccountNotificationServer')}
        />
      </SettingsSection>
    </AccountScreenLayout>
  );
};

export default NotificationSettingsScreen;
