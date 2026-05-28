// Shared Web-of-Trust chip (#535). Single source of truth for the chip's
// label, icon, colour, and tap behaviour across Messages, Hunt and Events.
//
// Visual: yellow background so the safety chip reads distinctly from the
// pink filter chips next to it. Leading shield icon reflects the active
// tier:
//   'friends' → ShieldCheck (strongest filter — only kind-3 follows pass)
//   'fof'     → ShieldQuestion (one-hop relaxation — some bot leakage possible)
//   'all'     → ShieldOff (filter disabled — secret mode only)

import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { ShieldCheck, ShieldOff, ShieldQuestion } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { WotTier } from '../services/wotSettingsService';
import type { Palette } from '../styles/palettes';

interface Props {
  currentTier: WotTier;
  onPress: () => void;
  testID?: string;
}

const labelFor = (tier: WotTier): string => {
  switch (tier) {
    case 'friends':
      return 'WoT: Friends';
    case 'fof':
      return 'WoT: Friends+';
    case 'all':
      return 'WoT: All';
  }
};

const WebOfTrustChip: React.FC<Props> = ({ currentTier, onPress, testID }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const Icon =
    currentTier === 'friends' ? ShieldCheck : currentTier === 'fof' ? ShieldQuestion : ShieldOff;
  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={onPress}
      testID={testID ?? 'wot-chip'}
      accessibilityLabel={`Web of Trust filter: ${labelFor(currentTier)}. Tap to change.`}
      accessibilityRole="button"
    >
      <Icon size={14} color={colors.textHeader} strokeWidth={2.5} />
      <Text style={styles.chipText}>{labelFor(currentTier)}</Text>
    </TouchableOpacity>
  );
};

// Exported helper so the host screens can render the same label in
// section-headers or banners without duplicating the casing.
export const wotTierLabel = labelFor;

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      // Yellow background distinguishes the safety chip from the pink
      // filter chips. zapYellow is the warmest yellow in the palette
      // (used for zap accents) — repurposed here as the WoT accent.
      backgroundColor: 'rgba(255, 193, 7, 0.18)',
      borderWidth: 1,
      borderColor: colors.zapYellow,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textHeader,
    },
  });

export default WebOfTrustChip;
