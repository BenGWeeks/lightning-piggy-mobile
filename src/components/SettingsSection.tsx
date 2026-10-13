import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Info } from 'lucide-react-native';
import SettingsInfoSheet from './SettingsInfoSheet';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { SettingsSectionCardContext } from '../contexts/SettingsSectionCardContext';
import { createSettingsSectionStyles } from '../styles/SettingsSection.styles';

interface Props {
  /** `account` = follows the signed-in account; `phone` = every account on this device. */
  scope: 'account' | 'phone';
  /** Adds the top gap that separates the second half of a screen from the first. */
  spaced?: boolean;
  testID: string;
  /** Omit children for the unchanged PR 0 header; migrations opt into the card. */
  children?: React.ReactNode;
  showInfo?: boolean;
  showHeading?: boolean;
}

const SettingsSection: React.FC<Props> = ({
  scope,
  spaced,
  testID,
  children,
  showInfo = true,
  showHeading = true,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createSettingsSectionStyles(colors), [colors]);
  const account = scope === 'account';
  const [infoOpen, setInfoOpen] = useState(false);
  const title = t(account ? 'settingsScope.forThisAccount' : 'settingsScope.onThisPhone');
  return (
    <View style={[styles.container, spaced && styles.gap]} testID={testID}>
      {showHeading && (
        <View style={styles.labelRow}>
          <Text style={styles.header} accessibilityRole="header">
            {title}
          </Text>
          {showInfo && (
            <TouchableOpacity
              style={styles.info}
              onPress={() => setInfoOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`${title}: ${t('securityScreen.details')}`}
              testID={`${testID}-info`}
            >
              <Info size={18} color={colors.white} />
            </TouchableOpacity>
          )}
        </View>
      )}
      {children != null && (
        <SettingsSectionCardContext.Provider value={true}>
          <View style={styles.card}>
            {React.Children.toArray(children).map((child, index) => (
              <React.Fragment key={index}>
                {index > 0 && <View style={styles.separator} />}
                {child}
              </React.Fragment>
            ))}
          </View>
        </SettingsSectionCardContext.Provider>
      )}
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

export default SettingsSection;
