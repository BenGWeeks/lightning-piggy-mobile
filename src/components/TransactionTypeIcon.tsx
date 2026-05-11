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
  // Badge is ~35 % of the icon — visible at a glance, doesn't crowd
  // the underlying glyph. Anchored top-right so it doesn't overlap
  // the row's text content on either side.
  const badgeSize = Math.round(size * 0.35);
  const badgeGlyph = Math.round(badgeSize * 0.62);
  // Badge half-overhangs the circle edge so it reads as "attached" to
  // the icon. Outer wrapper is `overflow: 'visible'` so the colored
  // disc's implicit `borderRadius` clipping doesn't hide it.
  const badgeOffset = -Math.round(badgeSize * 0.25);

  const bg =
    category === 'onchain'
      ? colors.bitcoinOrange
      : category === 'boltz'
        ? colors.boltzNavy
        : colors.brandPink;
  const fg = colors.zapYellow;

  return (
    <View
      style={[
        styles.outer,
        { width: size + Math.abs(badgeOffset) * 2, height: size + Math.abs(badgeOffset) * 2 },
      ]}
    >
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
        <View
          style={[
            styles.badge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              top: 0,
              right: 0,
              backgroundColor: colors.zapYellow,
            },
          ]}
          accessibilityLabel="Needs attention"
        >
          <AlertTriangle size={badgeGlyph} color="#000" strokeWidth={2.5} />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    // Outer wrapper sized slightly bigger than the disc so an absolutely-
    // positioned badge with a top-right anchor doesn't get clipped by
    // the disc's borderRadius (Android implicit overflow:hidden).
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
    // Crisp 2 px white ring around the badge so it pops against any
    // background colour (the bitcoin-orange or boltz-navy underneath).
    borderWidth: 2,
    borderColor: '#fff',
  },
});

export default React.memo(TransactionTypeIcon);
