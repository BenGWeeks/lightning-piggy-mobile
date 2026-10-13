import React, { useMemo, useState } from 'react';
import { Switch, Text, TouchableOpacity, View, type SwitchProps } from 'react-native';
import { ChevronRight, Info, type LucideIcon } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createSettingsRowStyles } from '../styles/SettingsRow.styles';
import SettingsInfoSheet from './SettingsInfoSheet';

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  testID: string;
  subtitleTestID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link';
  onPress?: () => void;
  toggle?: Pick<
    SwitchProps,
    'value' | 'onValueChange' | 'disabled' | 'testID' | 'accessibilityLabel'
  >;
  details?: React.ReactNode;
  infoTestID?: string;
}

/** Shared settings navigation/switch row. Fine print is one tap away. */
export default function SettingsRow({
  icon: Icon,
  title,
  subtitle,
  testID,
  subtitleTestID,
  accessibilityLabel,
  accessibilityRole = 'link',
  onPress,
  toggle,
  details,
  infoTestID = `${testID}-info`,
}: Props) {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createSettingsRowStyles(colors), [colors]);
  const [infoOpen, setInfoOpen] = useState(false);
  const content = (
    <>
      <View style={styles.icon}>
        <Icon size={22} color={colors.white} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1} testID={subtitleTestID}>
          {subtitle}
        </Text>
      </View>
      {onPress && <ChevronRight size={20} color={colors.white} />}
    </>
  );
  return (
    <>
      <View style={styles.row} testID={onPress ? undefined : testID} accessible={false}>
        {onPress ? (
          <TouchableOpacity
            style={styles.main}
            onPress={onPress}
            testID={testID}
            accessibilityRole={accessibilityRole}
            accessibilityLabel={accessibilityLabel ?? title}
            accessibilityHint={subtitle}
          >
            {content}
          </TouchableOpacity>
        ) : (
          <View style={styles.main} accessible={false}>
            {content}
          </View>
        )}
        {details && (
          <TouchableOpacity
            style={styles.info}
            onPress={() => setInfoOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${title}: ${t('securityScreen.details')}`}
            testID={infoTestID}
          >
            <Info size={20} color={colors.white} />
          </TouchableOpacity>
        )}
        {toggle && (
          <Switch
            {...toggle}
            accessibilityLabel={toggle.accessibilityLabel ?? title}
            accessibilityHint={subtitle}
            trackColor={{ false: colors.divider, true: colors.brandPink }}
            thumbColor={toggle.value ? colors.white : undefined}
          />
        )}
      </View>
      {details && (
        <SettingsInfoSheet
          visible={infoOpen}
          onClose={() => setInfoOpen(false)}
          title={title}
          testID={`${infoTestID}-sheet`}
        >
          {details}
        </SettingsInfoSheet>
      )}
    </>
  );
}
