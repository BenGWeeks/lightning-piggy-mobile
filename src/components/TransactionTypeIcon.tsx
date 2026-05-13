import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AlertTriangle, Link2, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { TxCategory } from '../utils/txCategory';

interface Props {
  category: TxCategory;
  size?: number;
  /** Renders a small yellow warning chip in the top-right corner. Used
   *  to flag Boltz swaps whose on-chain claim hasn't yet broadcast
   *  successfully — so users notice it in the transaction list without
   *  having to tap into TransactionDetailSheet. See issue #519. */
  needsAttention?: boolean;
}

const TransactionTypeIcon: React.FC<Props> = ({ category, size = 40, needsAttention = false }) => {
  const colors = useThemeColors();
  const radius = size / 2;
  const glyphSize = Math.round(size * 0.5);
  // Badge is ~45 % of the icon — large enough that the AlertTriangle
  // glyph survives the pixel budget (was 35 % → 9 px glyph rendered as
  // a blob). Anchored top-right so it doesn't overlap the row text.
  const badgeSize = Math.round(size * 0.45);
  const badgeGlyph = Math.round(badgeSize * 0.7);
  // Badge overhangs the disc's top-right corner via negative top/right
  // on an absolutely-positioned sibling. Layout box stays exactly
  // `size × size` so callers (e.g. TransactionList's 40×40 avatarWrap)
  // get the dimensions they asked for; only the badge visually escapes
  // via the outer wrapper's `overflow: 'visible'`.
  const badgeOverhang = Math.round(badgeSize * 0.25);

  const bg =
    category === 'onchain'
      ? colors.bitcoinOrange
      : category === 'boltz'
        ? colors.boltzNavy
        : colors.brandPink;
  const fg = colors.zapYellow;

  return (
    <View style={[styles.outer, { width: size, height: size }]}>
      <View
        style={[
          styles.disc,
          { width: size, height: size, borderRadius: radius, backgroundColor: bg },
        ]}
      >
        {category === 'onchain' ? (
          <Link2 size={glyphSize} color={colors.white} strokeWidth={2.5} />
        ) : (
          <Zap size={glyphSize} color={fg} fill={fg} strokeWidth={2} />
        )}
      </View>
      {needsAttention ? (
        // Sibling of the disc, positioned with negative top/right so it
        // visually overhangs into the outer wrapper's overflow:visible
        // padding. The visual "attached to corner" effect comes from the
        // overhang, not from clipping — the disc has overflow:hidden
        // (implied by borderRadius on Android) but the badge isn't a
        // descendant so it's never clipped by it.
        <View
          style={[
            styles.badge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              top: -badgeOverhang,
              right: -badgeOverhang,
              backgroundColor: colors.zapYellow,
              borderColor: colors.white,
            },
          ]}
          accessible
          accessibilityRole="image"
          accessibilityLabel="Needs attention"
        >
          <AlertTriangle size={badgeGlyph} color={colors.textHeader} strokeWidth={2.5} />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    // Layout box is exactly the requested `size × size` (set inline) so
    // callers with fixed-width rows (e.g. TransactionList's avatarWrap)
    // don't see the icon overflow their slot. The badge escapes this box
    // visually via negative top/right + the wrapper's overflow:visible.
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    // Crisp 2 px ring around the badge so it pops against any underlying
    // category colour. `borderColor` comes from the theme palette inline.
    borderWidth: 2,
  },
});

export default React.memo(TransactionTypeIcon);
