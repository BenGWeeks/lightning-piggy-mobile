import React from 'react';
import AccountScreenLayout from './AccountScreenLayout';
import MutedAccountsList from '../../components/MutedAccountsList';
import { useTranslation } from '../../contexts/LocaleContext';

export default function MutedAccountsScreen() {
  const t = useTranslation();
  return (
    <AccountScreenLayout
      title={t('notificationMute.accounts')}
      parent="AccountNotifications"
      scrollable={false}
    >
      <MutedAccountsList showHeading={false} />
    </AccountScreenLayout>
  );
}
