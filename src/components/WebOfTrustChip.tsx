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
import { Text, TouchableOpacity } from 'react-native';
import { ShieldCheck, ShieldOff, ShieldQuestion } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import type { WotTier } from '../services/wotSettingsService';
import { createWebOfTrustChipStyles } from '../styles/WebOfTrustChip.styles';

interface Props {
  currentTier: WotTier;
  onPress: () => void;
  testID?: string;
}

// "WoT" stays as the short technical prefix; the tier name is translated
// (same strings as the tier picker in WebOfTrustBottomSheet).
const labelFor = (tier: WotTier, t: ReturnType<typeof useTranslation>): string => {
  switch (tier) {
    case 'friends':
      return `WoT: ${t('webOfTrustBottomSheet.friendsTitle')}`;
    case 'fof':
      return `WoT: ${t('webOfTrustBottomSheet.friendsTitle')}+`;
    case 'all':
      return `WoT: ${t('webOfTrustBottomSheet.allTitle')}`;
  }
};

const WebOfTrustChip: React.FC<Props> = ({ currentTier, onPress, testID }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createWebOfTrustChipStyles(colors), [colors]);
  const label = labelFor(currentTier, t);
  const Icon =
    currentTier === 'friends' ? ShieldCheck : currentTier === 'fof' ? ShieldQuestion : ShieldOff;
  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={onPress}
      testID={testID ?? 'wot-chip'}
      accessibilityLabel={`${t('webOfTrustBottomSheet.title')}: ${label}`}
      accessibilityRole="button"
    >
      <Icon size={14} color={colors.textHeader} strokeWidth={2.5} />
      <Text style={styles.chipText}>{label}</Text>
    </TouchableOpacity>
  );
};

export default WebOfTrustChip;
