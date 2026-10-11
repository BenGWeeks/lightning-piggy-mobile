import React, { useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch } from 'react-native';
import { Check, ShieldCheck, Link2 } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { useAccountState } from '../../contexts/useAccountState';
import { useNostr } from '../../contexts/NostrContext';
import { createSecurityScreenStyles } from '../../styles/SecurityScreen.styles';
import KeyBackupEntry from '../../components/KeyBackupEntry';
import { Toast } from '../../components/BrandedToast';
import {
  DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS,
  getSendThreshold,
  setSendThreshold,
} from '../../services/sendThresholdService';
import { getLinkPreviewEnabled, setLinkPreviewEnabled } from '../../services/linkPreviewPreference';

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
  const { pubkey } = useNostr();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createSecurityScreenStyles(colors), [colors]);
  const [threshold, setThresholdState] = useAccountState<number | null>(
    pubkey,
    DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS,
  );
  const [customDraft, setCustomDraft] = useAccountState<string>(pubkey, '');
  const [linkPreviewOn, setLinkPreviewOn] = useAccountState<boolean>(pubkey, true);

  // Per-account settings: (re)load for the ACTIVE account, and ignore a late
  // answer for an account we've since switched away from.
  useEffect(() => {
    let cancelled = false;
    setCustomDraft('');
    getSendThreshold(pubkey).then((t) => {
      if (cancelled) return;
      setThresholdState(t);
      // If the saved threshold doesn't match a preset, surface it in the custom row.
      const isPreset = PRESETS.some((p) => p.value === t);
      if (!isPreset && t !== null) setCustomDraft(String(t));
    });
    getLinkPreviewEnabled(pubkey).then((v) => {
      if (!cancelled) setLinkPreviewOn(v);
    });
    return () => {
      cancelled = true;
    };
  }, [pubkey, setCustomDraft, setThresholdState, setLinkPreviewOn]);

  const handleToggleLinkPreview = async (next: boolean) => {
    setLinkPreviewOn(next);
    await setLinkPreviewEnabled(next, pubkey);
  };

  // `setSendThreshold` rejects (no active account, or the per-account
  // migration couldn't read the identity registry). Don't leave the screen
  // showing a value that wasn't saved: re-read the stored one and say so.
  const saveThreshold = async (value: number | null) => {
    try {
      await setSendThreshold(value, pubkey);
    } catch {
      Toast.show({
        type: 'error',
        text1: t('securityScreen.thresholdSaveFailed'),
        position: 'top',
      });
      const stored = await getSendThreshold(pubkey).catch(() => null);
      setThresholdState(stored ?? DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS);
    }
  };

  const handlePickPreset = async (value: number | null) => {
    setThresholdState(value);
    setCustomDraft('');
    await saveThreshold(value);
  };

  const handleCustomSave = async () => {
    const parsed = parseInt(customDraft.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setThresholdState(parsed);
    await saveThreshold(parsed);
  };

  const customActive = threshold !== null && !PRESETS.some((p) => p.value === threshold);

  return (
    <AccountScreenLayout title={t('securityScreen.title')}>
      <KeyBackupEntry />
      <View style={styles.headerRow}>
        <ShieldCheck size={22} color={colors.white} />
        <Text style={[sharedAccountStyles.sectionLabel, styles.headerLabel]}>
          {t('securityScreen.confirmLargeSends')}
        </Text>
      </View>
      <Text style={sharedAccountStyles.fieldHint}>{t('securityScreen.confirmLargeSendsHint')}</Text>
      <Text style={sharedAccountStyles.fieldHint}>{t('securityScreen.perAccountHint')}</Text>

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
        <Text style={[styles.optionLabel, styles.toggleLabel]}>
          {t('securityScreen.showLinkPreviews')}
        </Text>
        <Switch
          value={linkPreviewOn}
          onValueChange={handleToggleLinkPreview}
          accessibilityLabel={t('securityScreen.showLinkPreviewsA11y')}
          testID="security-link-preview-toggle"
          trackColor={{ false: colors.divider, true: colors.brandPink }}
          thumbColor={linkPreviewOn ? colors.white : undefined}
        />
      </View>
    </AccountScreenLayout>
  );
};

export default SecurityScreen;
