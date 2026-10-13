import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Info } from 'lucide-react-native';
import SettingsInfoSheet from './SettingsInfoSheet';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createSettingsScopeHeaderStyles } from '../styles/SettingsScopeHeader.styles';

interface Props {
  /** `account` = follows the signed-in account; `phone` = every account on this device. */
  scope: 'account' | 'phone';
  /** Adds the top gap that separates the second half of a screen from the first. */
  spaced?: boolean;
  testID: string;
}

const SettingsScopeHeader: React.FC<Props> = ({ scope, spaced, testID }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createSettingsScopeHeaderStyles(colors), [colors]);
  const account = scope === 'account';
  const [infoOpen, setInfoOpen] = useState(false);
  const title = t(account ? 'settingsScope.forThisAccount' : 'settingsScope.onThisPhone');
  return (
    <View style={[styles.container, spaced && styles.gap]} testID={testID}>
      <View style={styles.labelRow}>
        <Text style={styles.header} accessibilityRole="header">
          {title}
        </Text>
        <TouchableOpacity
          style={styles.info}
          onPress={() => setInfoOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${title}: ${t('securityScreen.details')}`}
          testID={`${testID}-info`}
        >
          <Info size={18} color={colors.white} />
        </TouchableOpacity>
      </View>
      <SettingsInfoSheet
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={title}
        testID={`${testID}-info-sheet`}
        paragraphs={[
          t(account ? 'settingsScope.forThisAccountHint' : 'settingsScope.onThisPhoneHint'),
        ]}
      />
    </View>
  );
};

export default SettingsScopeHeader;
