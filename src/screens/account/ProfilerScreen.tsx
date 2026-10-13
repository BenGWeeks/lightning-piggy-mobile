import React from 'react';
import AccountScreenLayout from './AccountScreenLayout';
import SettingsSection from '../../components/SettingsSection';
import HermesProfilerSection from '../../components/HermesProfilerSection';
import { useTranslation } from '../../contexts/LocaleContext';

export default function ProfilerScreen() {
  const t = useTranslation();
  return (
    <AccountScreenLayout title={t('hermesProfiler.title')} parent="AccountAdvanced">
      <SettingsSection scope="phone" testID="profiler-phone" />
      <HermesProfilerSection />
    </AccountScreenLayout>
  );
}
