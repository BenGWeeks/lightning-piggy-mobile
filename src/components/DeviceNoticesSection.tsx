import React, { useCallback, useMemo } from 'react';
import { Switch, Text, View } from 'react-native';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createAdvancedScreenStyles } from '../styles/AdvancedScreen.styles';
import { useDeviceNoticesEnabled } from '../hooks/useMarmotDevices';
import { saveDeviceNoticesEnabled } from '../services/deviceNoticesPreference';

/**
 * Settings → Advanced → On this phone → Developer options: "Show device
 * changes in chats" (#1267). Alpha-only: on by default in dev and preview
 * builds, off in the store build (see deviceNoticesPreference).
 */
const DeviceNoticesSection: React.FC = () => {
  const t = useTranslation();
  const colors = useThemeColors();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createAdvancedScreenStyles(colors), [colors]);
  const enabled = useDeviceNoticesEnabled();
  const toggle = useCallback((next: boolean) => void saveDeviceNoticesEnabled(next), []);
  return (
    <View style={styles.sectionGap} testID="advanced-developer-options">
      <Text style={shared.sectionLabel}>{t('advancedScreen.developerOptions')}</Text>
      <View style={styles.experimentalRow}>
        <View style={styles.experimentalTextBlock}>
          <Text style={styles.experimentalLabel}>{t('chatDevices.showChanges')}</Text>
          <Text style={styles.experimentalSubtitle}>{t('chatDevices.showChangesHint')}</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={toggle}
          accessibilityLabel={t('chatDevices.showChanges')}
          testID="advanced-device-notices-toggle"
          trackColor={{ false: colors.divider, true: colors.brandPink }}
          thumbColor={enabled ? colors.white : undefined}
        />
      </View>
    </View>
  );
};

export default DeviceNoticesSection;
