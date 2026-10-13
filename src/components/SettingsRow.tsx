import React, { useContext, useMemo, useState } from 'react';
import { Switch, Text, TouchableOpacity, View, type SwitchProps } from 'react-native';
import { ChevronRight, Info, type LucideIcon } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createSettingsRowStyles } from '../styles/SettingsRow.styles';
import SettingsInfoSheet from './SettingsInfoSheet';
import { SettingsSectionCardContext } from '../contexts/SettingsSectionCardContext';

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  value?: string;
  status?: 'ok' | 'warn' | 'error' | 'unknown';
  indent?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  disabledSubtitle?: string;
  /** For rows inside SettingsSection's grouped card. */
  grouped?: boolean;
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
  value,
  status,
  indent = false,
  destructive = false,
  disabled = false,
  disabledSubtitle,
  grouped: groupedProp,
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
  const inCard = useContext(SettingsSectionCardContext);
  const grouped = groupedProp ?? inCard;
  const rowDisabled = disabled || !!toggle?.disabled;
  const hint = rowDisabled && disabledSubtitle ? disabledSubtitle : (value ?? subtitle);
  const statusLabel = status ? t(`settingsKit.status.${status}`) : undefined;
  const accessibilityHint = [hint, statusLabel].filter(Boolean).join('. ');
  const foreground = destructive ? colors.red : colors.white;
  const statusColor =
    status &&
    { ok: colors.green, warn: colors.amber, error: colors.red, unknown: colors.textSupplementary }[
      status
    ];
  const content = (
    <>
      <View style={styles.icon}>
        <Icon size={22} color={foreground} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, destructive && styles.destructive]}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1} testID={subtitleTestID}>
          {hint}
        </Text>
      </View>
      {status && (
        <View
          style={[styles.status, { backgroundColor: statusColor }]}
          accessible
          accessibilityLabel={statusLabel}
          accessibilityRole="text"
        />
      )}
      {onPress && <ChevronRight size={20} color={foreground} />}
    </>
  );
  return (
    <>
      <View
        style={[
          styles.row,
          grouped && styles.grouped,
          indent && styles.indent,
          disabled && styles.disabled,
        ]}
        testID={onPress ? undefined : testID}
        accessible={false}
      >
        {onPress ? (
          <TouchableOpacity
            style={styles.main}
            onPress={onPress}
            disabled={rowDisabled}
            accessibilityState={{ disabled: rowDisabled }}
            testID={testID}
            accessibilityRole={accessibilityRole}
            accessibilityLabel={accessibilityLabel ?? title}
            accessibilityHint={accessibilityHint}
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
            <Info size={20} color={foreground} />
          </TouchableOpacity>
        )}
        {toggle && (
          <Switch
            {...toggle}
            testID={toggle.testID ?? `${testID}-toggle`}
            disabled={rowDisabled}
            accessibilityRole="switch"
            accessibilityState={{ checked: toggle.value, disabled: rowDisabled }}
            accessibilityLabel={toggle.accessibilityLabel ?? title}
            accessibilityHint={accessibilityHint}
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
