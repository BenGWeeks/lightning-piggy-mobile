import React from 'react';
import AccountScreenLayout from './AccountScreenLayout';
import SettingsSection from '../../components/SettingsSection';
import NotificationServerSection from '../../components/NotificationServerSection';
import { useTranslation } from '../../contexts/LocaleContext';

export default function NotificationServerScreen() {
  const t = useTranslation();
  return (
    <AccountScreenLayout title={t('securityScreen.marmotPushServerTitle')} parent="AccountAdvanced">
      <SettingsSection scope="phone" testID="notification-server-phone" />
      {/* #1430 owns this component; its default-server card drops in here unchanged. */}
      <NotificationServerSection />
    </AccountScreenLayout>
  );
}
