import React from 'react';
import AccountScreenLayout from './AccountScreenLayout';
import SettingsSection from '../../components/SettingsSection';
import OutgoingBubbleStyleSection from '../../components/OutgoingBubbleStyleSection';
import { useTranslation } from '../../contexts/LocaleContext';

export default function BubbleStyleScreen() {
  const t = useTranslation();
  return (
    <AccountScreenLayout title={t('advancedScreen.bubbleStyle')} parent="AccountAdvanced">
      <SettingsSection scope="phone" testID="bubble-style-phone" />
      <OutgoingBubbleStyleSection />
    </AccountScreenLayout>
  );
}
