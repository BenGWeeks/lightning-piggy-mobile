import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Link2 } from 'lucide-react-native';
import { colors } from '../styles/theme';
import type { TxCategory } from '../utils/txCategory';

interface Props {
  category: TxCategory;
  size?: number;
}

/**
 * Circular transaction-type badge used in the transaction list avatar slot
 * and at the top of the transaction detail sheet. Styling per category:
 *   - lightning → yellow ⚡ on brand-pink tint (matches existing list avatar)
 *   - boltz     → yellow ⚡ on Boltz navy (brand-matched)
 *   - onchain   → chain link glyph on Bitcoin-orange tint
 */
const TransactionTypeIcon: React.FC<Props> = ({ category, size = 40 }) => {
  const radius = size / 2;
  const glyphSize = Math.round(size * 0.5);

  if (category === 'onchain') {
    return (
      <View
        style={[
          styles.base,
          { width: size, height: size, borderRadius: radius, backgroundColor: colors.bitcoinOrangeLight },
        ]}
      >
        <Link2 size={glyphSize} color={colors.bitcoinOrange} strokeWidth={2.5} />
      </View>
    );
  }

  const bg = category === 'boltz' ? colors.boltzNavy : colors.brandPinkLight;
  const fg = category === 'boltz' ? colors.boltzYellow : colors.brandPink;
  return (
    <View
      style={[
        styles.base,
        { width: size, height: size, borderRadius: radius, backgroundColor: bg },
      ]}
    >
      <Text style={{ fontSize: glyphSize, color: fg, lineHeight: glyphSize * 1.1 }}>⚡</Text>
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
