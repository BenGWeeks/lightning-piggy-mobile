import React from 'react';
import AccountScreenLayout from './AccountScreenLayout';
import SettingsScopeHeader from '../../components/SettingsScopeHeader';
import HermesProfilerSection from '../../components/HermesProfilerSection';
import { useTranslation } from '../../contexts/LocaleContext';

export default function ProfilerScreen() {
  const t = useTranslation();
  return (
    <AccountScreenLayout title={t('hermesProfiler.title')} parent="AccountAdvanced">
      <SettingsScopeHeader scope="phone" testID="profiler-phone" />
      <HermesProfilerSection />
    </AccountScreenLayout>
  );
}
