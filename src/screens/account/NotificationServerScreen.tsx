import React from 'react';
import AccountScreenLayout from './AccountScreenLayout';
import SettingsScopeHeader from '../../components/SettingsScopeHeader';
import NotificationServerSection from '../../components/NotificationServerSection';
import { useTranslation } from '../../contexts/LocaleContext';

export default function NotificationServerScreen() {
  const t = useTranslation();
  return (
    <AccountScreenLayout title={t('securityScreen.marmotPushServerTitle')} parent="AccountAdvanced">
      <SettingsScopeHeader scope="phone" testID="notification-server-phone" />
      {/* #1430 owns this component; its default-server card drops in here unchanged. */}
      <NotificationServerSection />
    </AccountScreenLayout>
  );
}
