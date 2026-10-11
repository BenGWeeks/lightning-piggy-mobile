import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
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

/**
 * "For this account" / "On this phone" header that splits a settings screen
 * by where its settings are stored, so it's clear which ones change when
 * you switch accounts.
 */
const SettingsScopeHeader: React.FC<Props> = ({ scope, spaced, testID }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createSettingsScopeHeaderStyles(colors), [colors]);
  const account = scope === 'account';
  return (
    <View style={spaced && styles.gap} testID={testID}>
      <Text style={styles.header} accessibilityRole="header">
        {t(account ? 'settingsScope.forThisAccount' : 'settingsScope.onThisPhone')}
      </Text>
      <Text style={styles.hint}>
        {t(account ? 'settingsScope.forThisAccountHint' : 'settingsScope.onThisPhoneHint')}
      </Text>
    </View>
  );
};

export default SettingsScopeHeader;
