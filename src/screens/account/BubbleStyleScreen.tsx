import React from 'react';
import AccountScreenLayout from './AccountScreenLayout';
import SettingsScopeHeader from '../../components/SettingsScopeHeader';
import OutgoingBubbleStyleSection from '../../components/OutgoingBubbleStyleSection';
import { useTranslation } from '../../contexts/LocaleContext';

export default function BubbleStyleScreen() {
  const t = useTranslation();
  return (
    <AccountScreenLayout title={t('advancedScreen.bubbleStyle')} parent="AccountAdvanced">
      <SettingsScopeHeader scope="phone" testID="bubble-style-phone" />
      <OutgoingBubbleStyleSection />
    </AccountScreenLayout>
  );
}
