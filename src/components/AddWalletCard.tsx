import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createAddWalletCardStyles } from '../styles/AddWalletCard.styles';
import { walletCarouselStyles } from '../styles/WalletCarousel.styles';

interface AddWalletCardProps {
  onPress: () => void;
  carousel?: boolean;
}

const AddWalletCard: React.FC<AddWalletCardProps> = ({ onPress, carousel }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createAddWalletCardStyles(colors), [colors]);
  return (
    <View style={carousel ? walletCarouselStyles.cardContainer : styles.cardContainer}>
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        activeOpacity={0.7}
        testID="add-wallet-card"
        accessibilityLabel={t('addWalletCard.addWallet')}
      >
        <Text style={styles.plusIcon}>+</Text>
        <Text style={styles.label}>{t('addWalletCard.addWallet')}</Text>
      </TouchableOpacity>
    </View>
  );
};

export default React.memo(AddWalletCard);
