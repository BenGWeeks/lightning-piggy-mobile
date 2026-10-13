import React from 'react';
import AccountScreenLayout from './AccountScreenLayout';
import ShopAlertsSection from '../../components/ShopAlertsSection';
import { useTranslation } from '../../contexts/LocaleContext';

export default function ShopAlertsScreen() {
  const t = useTranslation();
  return (
    <AccountScreenLayout title={t('shopAlerts.title')} parent="AccountNotifications">
      <ShopAlertsSection />
    </AccountScreenLayout>
  );
}
