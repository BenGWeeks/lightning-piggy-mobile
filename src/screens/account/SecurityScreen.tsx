import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { Check, ShieldCheck, Link2 } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useThemeColors } from '../../contexts/ThemeContext';
import type { Palette } from '../../styles/palettes';
import {
  DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS,
  getSendThreshold,
  setSendThreshold,
} from '../../services/sendThresholdService';
import { getLinkPreviewEnabled, setLinkPreviewEnabled } from '../../services/linkPreviewPreference';

// Preset thresholds for the radio rows (sats). `null` = "Off".
const PRESETS: { value: number | null; label: string; sublabel: string }[] = [
  { value: null, label: 'Off', sublabel: 'Never confirm — every send is one-tap' },
  { value: 1_000, label: '1,000 sats', sublabel: '~£0.50 — confirm at or above this' },
  {
    value: DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS,
    label: '10,000 sats',
    sublabel: '~£5 — default; confirm at or above this',
  },
  { value: 100_000, label: '100,000 sats', sublabel: '~£50 — confirm at or above this' },
];

const SecurityScreen: React.FC = () => {
  const colors = useThemeColors();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [threshold, setThresholdState] = useState<number | null>(
    DEFAULT_HIGH_VALUE_SEND_THRESHOLD_SATS,
  );
  const [customDraft, setCustomDraft] = useState<string>('');
  const [linkPreviewOn, setLinkPreviewOn] = useState<boolean>(true);

  useEffect(() => {
    getSendThreshold().then((t) => {
      setThresholdState(t);
      // If the saved threshold doesn't match a preset, surface it in the custom row.
      const isPreset = PRESETS.some((p) => p.value === t);
      if (!isPreset && t !== null) setCustomDraft(String(t));
    });
    getLinkPreviewEnabled().then(setLinkPreviewOn);
  }, []);

  const handleToggleLinkPreview = async (next: boolean) => {
    setLinkPreviewOn(next);
    await setLinkPreviewEnabled(next);
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
    <AccountScreenLayout title="Security">
      <View style={styles.headerRow}>
        <ShieldCheck size={22} color={colors.brandPink} />
        <Text style={[sharedAccountStyles.sectionLabel, styles.headerLabel]}>
          Confirm large sends
        </Text>
      </View>
      <Text style={sharedAccountStyles.fieldHint}>
        Show an "Are you sure?" prompt before dispatching a Lightning payment or wallet transfer at
        or above this many sats. Smaller sends stay one-tap. Default: 10,000 sats.
      </Text>

      <View style={styles.optionList}>
        {PRESETS.map((opt) => {
          const selected = opt.value === threshold && !customActive;
          return (
            <TouchableOpacity
              key={String(opt.value)}
              style={[styles.optionRow, selected && styles.optionRowSelected]}
              onPress={() => handlePickPreset(opt.value)}
              accessibilityLabel={opt.label}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`security-threshold-${opt.value === null ? 'off' : opt.value}`}
            >
              <View style={styles.optionTextBlock}>
                <Text style={styles.optionLabel}>{opt.label}</Text>
                <Text style={styles.optionSublabel}>{opt.sublabel}</Text>
              </View>
              {selected && <Check size={18} color={colors.brandPink} />}
            </TouchableOpacity>
          );
        })}

        <View style={[styles.optionRow, customActive && styles.optionRowSelected]}>
          <View style={styles.optionTextBlock}>
            <Text style={styles.optionLabel}>Custom</Text>
            <View style={styles.customInputRow}>
              <TextInput
                style={styles.customInput}
                value={customDraft}
                onChangeText={setCustomDraft}
                onBlur={handleCustomSave}
                placeholder="e.g. 25000"
                placeholderTextColor={colors.textSupplementary}
                keyboardType="numeric"
                testID="security-threshold-custom-input"
                accessibilityLabel="Custom threshold in sats"
              />
              <Text style={styles.customSatsLabel}>sats</Text>
            </View>
          </View>
          {customActive && <Check size={18} color={colors.brandPink} />}
        </View>
      </View>

      <View style={[styles.headerRow, styles.sectionGap]}>
        <Link2 size={22} color={colors.brandPink} />
        <Text style={[sharedAccountStyles.sectionLabel, styles.headerLabel]}>
          Link previews in messages
        </Text>
      </View>
      <Text style={sharedAccountStyles.fieldHint}>
        When ON, your phone fetches a preview card (title, image, summary) for any URL shared in a
        message — automatically, as the message renders, even if you never tap it. The fetch tells
        the URL's host that someone is previewing the page. Turn OFF if you'd rather keep that
        traffic private. Default: ON.
      </Text>
      <View style={styles.toggleRow}>
        <Text style={styles.optionLabel}>Show link previews</Text>
        <Switch
          value={linkPreviewOn}
          onValueChange={handleToggleLinkPreview}
          accessibilityLabel="Show link previews in messages"
          testID="security-link-preview-toggle"
          trackColor={{ false: colors.divider, true: colors.brandPink }}
        />
      </View>
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
      borderColor: colors.brandPink,
      backgroundColor: colors.brandPinkLight,
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
