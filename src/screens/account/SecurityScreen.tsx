import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Platform,
} from 'react-native';
import { Check, ShieldCheck, Link2, BellRing, Radio } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import type { Palette } from '../../styles/palettes';
import {
  DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS,
  getSendThreshold,
  setSendThreshold,
} from '../../services/sendThresholdService';
import { getLinkPreviewEnabled, setLinkPreviewEnabled } from '../../services/linkPreviewPreference';
import {
  getLockScreenContentEnabled,
  setLockScreenContentEnabled,
  requestNotificationPermission,
} from '../../services/notificationService';
import {
  loadBackgroundDmEnabled,
  setBackgroundDmEnabled,
} from '../../services/backgroundDmPreference';
import { startBackgroundDmWatch, stopBackgroundDmWatch } from '../../services/backgroundDmService';

// Preset thresholds for the radio rows (sats). `null` = "Off".
// Labels/sublabels are i18n keys resolved at render time (see below).
const PRESETS: { value: number | null; labelKey: string; sublabelKey: string }[] = [
  { value: null, labelKey: 'securityScreen.presetOff', sublabelKey: 'securityScreen.presetOffSub' },
  {
    value: 1_000,
    labelKey: 'securityScreen.preset1k',
    sublabelKey: 'securityScreen.preset1kSub',
  },
  {
    value: DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS,
    labelKey: 'securityScreen.preset10k',
    sublabelKey: 'securityScreen.preset10kSub',
  },
  {
    value: 100_000,
    labelKey: 'securityScreen.preset100k',
    sublabelKey: 'securityScreen.preset100kSub',
  },
];

const SecurityScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [threshold, setThresholdState] = useState<number | null>(
    DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS,
  );
  const [customDraft, setCustomDraft] = useState<string>('');
  const [linkPreviewOn, setLinkPreviewOn] = useState<boolean>(true);
  const [lockScreenContentOn, setLockScreenContentOn] = useState<boolean>(false);
  // Background DM watch is Android-only (iOS can't hold a background socket).
  const [backgroundDmOn, setBackgroundDmOn] = useState<boolean>(false);
  const isAndroid = Platform.OS === 'android';

  useEffect(() => {
    getSendThreshold().then((t) => {
      setThresholdState(t);
      // If the saved threshold doesn't match a preset, surface it in the custom row.
      const isPreset = PRESETS.some((p) => p.value === t);
      if (!isPreset && t !== null) setCustomDraft(String(t));
    });
    getLinkPreviewEnabled().then(setLinkPreviewOn);
    getLockScreenContentEnabled().then(setLockScreenContentOn);
    if (isAndroid) loadBackgroundDmEnabled().then(setBackgroundDmOn);
  }, [isAndroid]);

  const handleToggleLinkPreview = async (next: boolean) => {
    setLinkPreviewOn(next);
    await setLinkPreviewEnabled(next);
  };

  const handleToggleLockScreenContent = async (next: boolean) => {
    setLockScreenContentOn(next);
    await setLockScreenContentEnabled(next);
  };

  const handleToggleBackgroundDm = async (next: boolean) => {
    if (next) {
      // Turning ON needs notification permission for the persistent chip +
      // per-message alerts. If the user denies, leave the toggle off rather
      // than running a watch that can never surface anything.
      const granted = await requestNotificationPermission();
      if (!granted) {
        setBackgroundDmOn(false);
        return;
      }
      setBackgroundDmOn(true);
      await setBackgroundDmEnabled(true);
      await startBackgroundDmWatch();
    } else {
      setBackgroundDmOn(false);
      await setBackgroundDmEnabled(false);
      await stopBackgroundDmWatch();
    }
  };

  const handlePickPreset = async (value: number | null) => {
    setThresholdState(value);
    setCustomDraft('');
    await setSendThreshold(value);
  };

  const handleCustomSave = async () => {
    const parsed = parseInt(customDraft.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setThresholdState(parsed);
    await setSendThreshold(parsed);
  };

  const customActive = threshold !== null && !PRESETS.some((p) => p.value === threshold);

  return (
    <AccountScreenLayout title={t('securityScreen.title')}>
      <View style={styles.headerRow}>
        <ShieldCheck size={22} color={colors.white} />
        <Text style={[sharedAccountStyles.sectionLabel, styles.headerLabel]}>
          {t('securityScreen.confirmLargeSends')}
        </Text>
      </View>
      <Text style={sharedAccountStyles.fieldHint}>{t('securityScreen.confirmLargeSendsHint')}</Text>

      <View style={styles.optionList}>
        {PRESETS.map((opt) => {
          const selected = opt.value === threshold && !customActive;
          return (
            <TouchableOpacity
              key={String(opt.value)}
              style={[styles.optionRow, selected && styles.optionRowSelected]}
              onPress={() => handlePickPreset(opt.value)}
              accessibilityLabel={t(opt.labelKey)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`security-threshold-${opt.value === null ? 'off' : opt.value}`}
            >
              <View style={styles.optionTextBlock}>
                <Text style={styles.optionLabel}>{t(opt.labelKey)}</Text>
                <Text style={styles.optionSublabel}>{t(opt.sublabelKey)}</Text>
              </View>
              {selected && <Check size={18} color={colors.brandPink} />}
            </TouchableOpacity>
          );
        })}

        <View style={[styles.optionRow, customActive && styles.optionRowSelected]}>
          <View style={styles.optionTextBlock}>
            <Text style={styles.optionLabel}>{t('securityScreen.custom')}</Text>
            <View style={styles.customInputRow}>
              <TextInput
                style={styles.customInput}
                value={customDraft}
                onChangeText={setCustomDraft}
                onBlur={handleCustomSave}
                placeholder={t('securityScreen.customPlaceholder')}
                placeholderTextColor={colors.textSupplementary}
                keyboardType="numeric"
                testID="security-threshold-custom-input"
                accessibilityLabel={t('securityScreen.customThresholdLabel')}
              />
              <Text style={styles.customSatsLabel}>{t('securityScreen.sats')}</Text>
            </View>
          </View>
          {customActive && <Check size={18} color={colors.brandPink} />}
        </View>
      </View>

      <View style={[styles.headerRow, styles.sectionGap]}>
        <Link2 size={22} color={colors.white} />
        <Text style={[sharedAccountStyles.sectionLabel, styles.headerLabel]}>
          {t('securityScreen.linkPreviews')}
        </Text>
      </View>
      <Text style={sharedAccountStyles.fieldHint}>{t('securityScreen.linkPreviewsHint')}</Text>
      <View style={styles.toggleRow}>
        <Text style={styles.optionLabel}>{t('securityScreen.showLinkPreviews')}</Text>
        <Switch
          value={linkPreviewOn}
          onValueChange={handleToggleLinkPreview}
          accessibilityLabel={t('securityScreen.showLinkPreviewsA11y')}
          testID="security-link-preview-toggle"
          trackColor={{ false: colors.divider, true: colors.brandPink }}
          thumbColor={colors.white}
        />
      </View>

      <View style={[styles.headerRow, styles.sectionGap]}>
        <BellRing size={22} color={colors.white} />
        <Text style={[sharedAccountStyles.sectionLabel, styles.headerLabel]}>
          {t('securityScreen.notificationContent')}
        </Text>
      </View>
      <Text style={sharedAccountStyles.fieldHint}>
        {t('securityScreen.notificationContentHint')}
      </Text>
      <View style={styles.toggleRow}>
        <Text style={styles.optionLabel}>{t('securityScreen.showMessagePaymentDetails')}</Text>
        <Switch
          value={lockScreenContentOn}
          onValueChange={handleToggleLockScreenContent}
          accessibilityLabel={t('securityScreen.showMessagePaymentDetailsA11y')}
          testID="security-lockscreen-content-toggle"
          trackColor={{ false: colors.divider, true: colors.brandPink }}
          thumbColor={colors.white}
        />
      </View>

      {isAndroid && (
        <>
          <View style={[styles.headerRow, styles.sectionGap]}>
            <Radio size={22} color={colors.white} />
            <Text style={[sharedAccountStyles.sectionLabel, styles.headerLabel]}>
              {t('securityScreen.backgroundNotifications')}
            </Text>
          </View>
          <Text style={sharedAccountStyles.fieldHint}>
            {t('securityScreen.backgroundNotificationsHint')}
          </Text>
          <View style={styles.toggleRow}>
            <Text style={styles.optionLabel}>{t('securityScreen.watchForMessages')}</Text>
            <Switch
              value={backgroundDmOn}
              onValueChange={handleToggleBackgroundDm}
              accessibilityLabel={t('securityScreen.watchForMessages')}
              testID="security-background-dm-toggle"
              trackColor={{ false: colors.divider, true: colors.brandPink }}
              thumbColor={colors.white}
            />
          </View>
        </>
      )}
    </AccountScreenLayout>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    headerLabel: {
      marginBottom: 0,
    },
    sectionGap: {
      marginTop: 24,
    },
    optionList: {
      marginTop: 16,
      gap: 8,
    },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    optionRowSelected: {
      // Selected radio row — purple accent + tint, matching the selected/
      // active state convention across Settings.
      borderColor: colors.accentSecondary,
      backgroundColor: colors.accentSecondaryLight,
    },
    optionTextBlock: {
      flex: 1,
      marginRight: 8,
    },
    optionLabel: {
      fontSize: 15,
      color: colors.textHeader,
      fontWeight: '600',
    },
    optionSublabel: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    customInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 8,
    },
    customInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
      fontSize: 14,
      color: colors.textHeader,
      backgroundColor: colors.background,
    },
    customSatsLabel: {
      fontSize: 13,
      color: colors.textSupplementary,
      fontWeight: '500',
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
      marginTop: 8,
    },
  });

export default SecurityScreen;
