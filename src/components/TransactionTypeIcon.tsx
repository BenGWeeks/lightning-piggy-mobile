import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Link2, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { TxCategory } from '../utils/txCategory';

interface Props {
  category: TxCategory;
  size?: number;
}

const TransactionTypeIcon: React.FC<Props> = ({ category, size = 40 }) => {
  const colors = useThemeColors();
  const radius = size / 2;
  const glyphSize = Math.round(size * 0.5);

  if (category === 'onchain') {
    return (
      <View
        style={[
          styles.base,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: colors.bitcoinOrange,
          },
        ]}
      >
        <Link2 size={glyphSize} color={colors.white} strokeWidth={2.5} />
      </View>
    );
  }

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

export default React.memo(TransactionTypeIcon);
