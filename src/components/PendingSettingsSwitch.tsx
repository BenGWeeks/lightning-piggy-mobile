import React, { useMemo } from 'react';
import { Switch, View } from 'react-native';
import ScanRingSpinner from './ScanRingSpinner';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createPendingSettingsSwitchStyles } from '../styles/PendingSettingsSwitch.styles';

type Props = React.ComponentProps<typeof Switch> & { pending: boolean; pendingTestID?: string };

/** Pending work blocks repeat taps without giving the switch disabled colours. */
const PendingSettingsSwitch: React.FC<Props> = ({ pending, pendingTestID, ...props }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createPendingSettingsSwitchStyles(), []);
  return (
    <View style={styles.controls}>
      {pending && (
        <View
          testID={pendingTestID ?? `${props.testID}-pending`}
          accessibilityRole="progressbar"
          accessibilityLabel={t('notificationSettingsScreen.updating')}
        >
          <ScanRingSpinner size={18} color={colors.brandPink} strokeWidth={2} />
        </View>
      )}
      <View pointerEvents={pending ? 'none' : 'auto'}>
        <Switch
          {...props}
          accessibilityState={{ ...props.accessibilityState, busy: pending }}
          onValueChange={pending ? undefined : props.onValueChange}
        />
      </View>
    </View>
  );
};

export default React.memo(PendingSettingsSwitch);
