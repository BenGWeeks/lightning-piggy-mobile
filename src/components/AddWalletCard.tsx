import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CARD_WIDTH, CARD_MARGIN } from './WalletCard';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface AddWalletCardProps {
  onPress: () => void;
}

const AddWalletCard: React.FC<AddWalletCardProps> = ({ onPress }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.cardContainer}>
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        activeOpacity={0.7}
        testID="add-wallet-card"
        accessibilityLabel="Add Wallet"
      >
        <Text style={styles.plusIcon}>+</Text>
        <Text style={styles.label}>Add Wallet</Text>
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    cardContainer: {
      width: CARD_WIDTH,
      marginHorizontal: CARD_MARGIN,
    },
    card: {
      height: 200,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: colors.divider,
      borderStyle: 'dashed',
      backgroundColor: 'rgba(255,255,255,0.1)',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    },
    plusIcon: {
      fontSize: 48,
      fontWeight: '300',
      color: colors.white,
      opacity: 0.7,
    },
    label: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.white,
      opacity: 0.7,
    },
  });

export default AddWalletCard;
