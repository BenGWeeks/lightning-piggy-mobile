import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { hasPrize } from '../utils/cachePrize';

interface Props {
  /** Whether the cache is a Lightning Piggy (carries the NIP-32 LP label). */
  isLpPiggy: boolean;
  /** Advertised prize in sats — null/undefined when the listing has none. */
  payoutSats: number | null | undefined;
  /**
   * Where the badge sits relative to its (position:relative) parent.
   * Defaults to the icon-corner overhang used by the Geo-caches list +
   * My Piglets (40–44 px chassis). The Explore card passes a positive
   * inset instead so the badge stays inside the full-width thumbnail
   * rather than overflowing the card edge.
   */
  offset?: { top: number; right: number };
}

/**
 * The yellow ⚡ badge that marks an LP Piglet carrying a withdrawable
 * prize. Single source of truth so the Geo-caches list (HuntScreen),
 * the Explore hub rail, and My Piglets stay in visual + behavioural
 * lockstep — extracted from three inline copies during the #682 review.
 *
 * Renders nothing unless the cache is an LP Piggy with a known payout
 * (`isLpPiggy && payoutSats != null`), matching the gate every caller
 * used. The host view must be `position: 'relative'` so the absolutely
 * positioned badge anchors to it.
 *
 * Accessibility: announced as "Lightning payout available" so the prize
 * indicator isn't lost to screen-reader users (#682 review) — it's a
 * meaningful status, not decoration.
 */
export const LpPayoutBadge: React.FC<Props> = ({ isLpPiggy, payoutSats, offset }) => {
  const colors = useThemeColors();
  if (!hasPrize({ isLpPiggy, payoutSats })) return null;
  return (
    <View
      style={[styles.badge, { backgroundColor: colors.surface }, offset]}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Lightning payout available"
    >
      <Zap size={13} color={colors.zapYellow} fill={colors.zapYellow} strokeWidth={2} />
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
