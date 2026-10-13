import React, { useEffect, useMemo } from 'react';
import { View, Text, TextInput } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { useAccountState } from '../../contexts/useAccountState';
import { useNostr } from '../../contexts/NostrContext';
import { createSecurityScreenStyles } from '../../styles/SecurityScreen.styles';
import KeyBackupEntry from '../../components/KeyBackupEntry';
import SettingsSection from '../../components/SettingsSection';
import SettingsRow from '../../components/SettingsRow';
import SettingsInfoSheet from '../../components/SettingsInfoSheet';
import { useSettingsPicker } from '../../hooks/useSettingsPicker';
import { Toast } from '../../components/BrandedToast';
import {
  DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS,
  getSendThreshold,
  setSendThreshold,
} from '../../services/sendThresholdService';

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
  const styles = useMemo(() => createSecurityScreenStyles(colors), [colors]);
  const [threshold, setThresholdState] = useAccountState<number | null>(
    pubkey,
    DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS,
  );
  const [customDraft, setCustomDraft] = useAccountState<string>(pubkey, '');

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
    return () => {
      cancelled = true;
    };
  }, [pubkey, setCustomDraft, setThresholdState]);

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

  const [customOpen, setCustomOpen] = useAccountState(pubkey, false);
  const openPicker = useSettingsPicker(pubkey, (value) => {
    if (value === 'custom') setCustomOpen(true);
    else void handlePickPreset(value === 'off' ? null : Number(value));
  });

  const customActive = threshold !== null && !PRESETS.some((p) => p.value === threshold);

  return (
    <AccountScreenLayout title={t('securityScreen.title')}>
      <SettingsSection scope="account" testID="security-account">
        <KeyBackupEntry />
        <SettingsRow
          icon={ShieldCheck}
          title={t('securityScreen.confirmLargeSends')}
          value={
            threshold === null
              ? t('securityScreen.presetOff')
              : t('settingsScreens.thresholdValue', { amount: threshold.toLocaleString() })
          }
          details={t('securityScreen.confirmLargeSendsHint')}
          testID="security-confirm-large-payments"
          onPress={() =>
            openPicker({
              title: t('securityScreen.confirmLargeSends'),
              selectedValue: customActive
                ? 'custom'
                : threshold === null
                  ? 'off'
                  : String(threshold),
              testID: 'security-threshold-picker',
              options: PRESETS.map((opt) => ({
                value: opt.value === null ? 'off' : String(opt.value),
                label: t(opt.labelKey),
                subtitle: t(opt.sublabelKey),
                testID: `security-threshold-${opt.value === null ? 'off' : opt.value}`,
              })),
              customOption: {
                value: 'custom',
                label: t('securityScreen.custom'),
                testID: 'security-threshold-custom',
              },
            })
          }
        />
      </SettingsSection>
      <SettingsInfoSheet
        visible={customOpen}
        onClose={() => setCustomOpen(false)}
        title={t('securityScreen.custom')}
        testID="security-custom-sheet"
      >
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
      </SettingsInfoSheet>
    </AccountScreenLayout>
  );
};

export default SecurityScreen;
