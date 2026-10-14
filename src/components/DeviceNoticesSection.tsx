import React, { useCallback } from 'react';
import { View } from 'react-native';
import { Smartphone } from 'lucide-react-native';
import SettingsRow from './SettingsRow';
import { useTranslation } from '../contexts/LocaleContext';
import { useDeviceNoticesEnabled } from '../hooks/useMarmotDevices';
import { saveDeviceNoticesEnabled } from '../services/deviceNoticesPreference';

/**
 * Settings → Advanced → On this phone → Developer options: "Show device
 * changes in chats" (#1267). Alpha-only: on by default in dev and preview
 * builds, off in the store build (see deviceNoticesPreference).
 */
const DeviceNoticesSection: React.FC = () => {
  const t = useTranslation();
  const enabled = useDeviceNoticesEnabled();
  const toggle = useCallback((next: boolean) => void saveDeviceNoticesEnabled(next), []);
  return (
    <View testID="advanced-developer-options">
      <SettingsRow
        kind="toggle"
        icon={Smartphone}
        title={t('chatDevices.showChanges')}
        subtitle={t('settingsRows.deviceChangesSubtitle')}
        testID="advanced-device-notices"
        details={t('chatDevices.showChangesHint')}
        toggle={{ value: enabled, onValueChange: toggle, testID: 'advanced-device-notices-toggle' }}
      />
    </View>
  );
};
export default DeviceNoticesSection;
