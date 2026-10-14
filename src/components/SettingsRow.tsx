import React, { useContext, useMemo, useState } from 'react';
import { Switch, Text, TouchableOpacity, View, type SwitchProps } from 'react-native';
import { ChevronRight, ExternalLink, Info, type LucideIcon } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createSettingsRowStyles } from '../styles/SettingsRow.styles';
import PendingSettingsSwitch from './PendingSettingsSwitch';
import SettingsInfoSheet from './SettingsInfoSheet';
import { SettingsSectionCardContext } from '../contexts/SettingsSectionCardContext';
import {
  isTwoLineSettingsRow,
  resolveSettingsRowKind,
  settingsRowAccessibilityRole,
  settingsRowTrailing,
} from '../utils/settingsRowKind';

type ToggleConfig = Pick<
  SwitchProps,
  'value' | 'onValueChange' | 'disabled' | 'testID' | 'accessibilityLabel'
> & { pending?: boolean; pendingTestID?: string };

/**
 * The row's kind decides its trailing affordance (#1552), so a screen can't
 * put a chevron on an external link or a switch on a navigation row.
 */
type KindProps =
  /** In-app screen / sheet / picker. A missing handler renders as a read-only row. */
  | { kind: 'navigate'; onPress: (() => void) | undefined; toggle?: never }
  /** Opens a URL or another app: ↗ instead of a chevron, announced as a link. */
  | { kind: 'external'; onPress: () => void; toggle?: never }
  /** Acts on the spot (save, share, remove): no trailing affordance. */
  | { kind: 'action'; onPress: () => void; toggle?: never }
  | { kind: 'toggle'; toggle: ToggleConfig; onPress?: never }
  | { kind: 'value'; onPress?: never; toggle?: never }
  /** Derived as `navigate`. Prefer an explicit `kind`; kept so in-flight branches compile. */
  | { kind?: undefined; onPress: () => void; toggle?: never };

type Props = KindProps & {
  icon: LucideIcon;
  title: string;
  appearance?: 'gradient' | 'surface';
  iconColor?: string;
  iconBackground?: string;
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
  details?: React.ReactNode;
  infoTestID?: string;
};

/**
 * Shared settings row. Layout, always: [icon] [title / second line] … [ⓘ]
 * [one trailing affordance]. Fine print is one tap away behind ⓘ; rows with
 * no second line collapse to single-line height.
 */
export default function SettingsRow({
  kind: kindProp,
  icon: Icon,
  title,
  appearance = 'gradient',
  iconColor,
  iconBackground,
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
  const kind = resolveSettingsRowKind({ kind: kindProp, onPress, toggle });
  const trailing = settingsRowTrailing(kind);
  const pressable = kind === 'navigate' || kind === 'external' || kind === 'action';
  const ToggleControl = toggle?.pending !== undefined ? PendingSettingsSwitch : Switch;
  const rowDisabled = disabled || !!toggle?.disabled;
  const hint = rowDisabled && disabledSubtitle ? disabledSubtitle : (value ?? subtitle);
  const twoLine = isTwoLineSettingsRow(hint);
  const statusLabel = status ? t(`settingsKit.status.${status}`) : undefined;
  const accessibilityHint = [
    twoLine ? hint : undefined,
    statusLabel,
    kind === 'external' ? t('settingsKit.opensInBrowser') : undefined,
  ]
    .filter(Boolean)
    .join('. ');
  const foreground = destructive
    ? colors.red
    : appearance === 'surface'
      ? colors.textHeader
      : colors.white;
  const statusColor =
    status &&
    { ok: colors.green, warn: colors.amber, error: colors.red, unknown: colors.textSupplementary }[
      status
    ];
  const height = twoLine ? undefined : styles.compact;
  const content = (
    <>
      <View
        style={[
          styles.icon,
          iconBackground ? styles.colorChip : undefined,
          iconBackground ? { backgroundColor: iconBackground } : undefined,
        ]}
      >
        <Icon size={22} color={iconColor ?? foreground} />
      </View>
      <View style={styles.text}>
        <Text
          style={[
            styles.title,
            appearance === 'surface' && styles.surfaceTitle,
            destructive && styles.destructive,
          ]}
        >
          {title}
        </Text>
        {twoLine && (
          <Text
            style={[styles.subtitle, appearance === 'surface' && styles.surfaceSubtitle]}
            numberOfLines={1}
            testID={subtitleTestID}
          >
            {hint}
          </Text>
        )}
      </View>
      {status && (
        <View
          style={[styles.status, { backgroundColor: statusColor }]}
          accessible
          accessibilityLabel={statusLabel}
          accessibilityRole="text"
        />
      )}
    </>
  );
  return (
    <>
      <View
        style={[
          styles.row,
          height,
          appearance === 'surface' && styles.surface,
          grouped && styles.grouped,
          indent && styles.indent,
          disabled && styles.disabled,
        ]}
        testID={pressable ? undefined : testID}
        accessible={false}
      >
        {pressable ? (
          <TouchableOpacity
            style={[styles.main, height]}
            onPress={onPress}
            disabled={rowDisabled}
            accessibilityState={{ disabled: rowDisabled }}
            testID={testID}
            accessibilityRole={settingsRowAccessibilityRole(kind)}
            accessibilityLabel={accessibilityLabel ?? title}
            accessibilityHint={accessibilityHint}
          >
            {content}
          </TouchableOpacity>
        ) : (
          <View style={[styles.main, height]} accessible={false}>
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
        {(trailing === 'chevron' || trailing === 'external') && (
          // Extends the row's tap target to the far edge; screen readers
          // already get the whole row (and its hint) from the main target.
          <TouchableOpacity
            style={styles.trailing}
            onPress={onPress}
            disabled={rowDisabled}
            accessible={false}
            testID={`${testID}-${trailing}`}
          >
            {trailing === 'chevron' ? (
              <ChevronRight size={20} color={foreground} />
            ) : (
              <ExternalLink size={16} color={foreground} />
            )}
          </TouchableOpacity>
        )}
        {trailing === 'switch' && toggle && (
          <ToggleControl
            pending={toggle.pending ?? false}
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
