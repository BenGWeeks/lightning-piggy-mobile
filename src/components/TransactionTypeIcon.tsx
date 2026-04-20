import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Link2, Zap } from 'lucide-react-native';
import { colors } from '../styles/theme';
import type { TxCategory } from '../utils/txCategory';

interface Props {
  category: TxCategory;
  size?: number;
}

/**
 * Circular transaction-type badge used in the transaction list avatar slot
 * and at the top of the transaction detail sheet. Styling per category:
 *   - lightning → filled ⚡ on brand-pink tint
 *   - boltz     → filled ⚡ on Boltz navy (brand-matched)
 *   - onchain   → chain-link glyph on Bitcoin-orange tint (not a zap)
 */
const TransactionTypeIcon: React.FC<Props> = ({ category, size = 40 }) => {
  const radius = size / 2;
  const glyphSize = Math.round(size * 0.5);

  if (category === 'onchain') {
    return (
      <View
        style={[
          styles.base,
          { width: size, height: size, borderRadius: radius, backgroundColor: colors.bitcoinOrange },
        ]}
      >
        <Link2 size={glyphSize} color={colors.white} strokeWidth={2.5} />
      </View>
    );
  }

  // Lightning-Piggy pink + Boltz navy backgrounds both carry a yellow zap
  // for a consistent "it's a Lightning-style tx" read.
  const bg = category === 'boltz' ? colors.boltzNavy : colors.brandPink;
  const fg = colors.zapYellow;
  return (
    <View
      style={[
        styles.base,
        { width: size, height: size, borderRadius: radius, backgroundColor: bg },
      ]}
    >
      <Zap size={glyphSize} color={fg} fill={fg} strokeWidth={2} />
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default TransactionTypeIcon;
