import React, { useCallback, useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import type { CarouselItem } from '../hooks/useWalletCarousel';
import { walletCardGradientColors } from '../utils/walletCardColors';
import { cardThemes, defaultCardThemeFor } from '../themes/cardThemes';
import { useLocale } from '../contexts/LocaleContext';
import { walletCarouselStyles as styles } from '../styles/WalletCarousel.styles';

const GRADIENT_START = { x: 0, y: 0 };
const GRADIENT_END = { x: 1, y: 1 };

interface Props {
  item: CarouselItem;
  index: number;
  selected: boolean;
  scrollIndex: SharedValue<number>;
  onPress: (index: number) => void;
}

const WalletStripChip = ({ item, index, selected, scrollIndex, onPress }: Props) => {
  const highlight = useAnimatedStyle(() => {
    const active = scrollIndex.value === index;
    return {
      opacity: active ? 1 : 0.7,
      borderColor: active ? '#FFFFFF' : 'transparent',
      transform: [{ scale: active ? 1.06 : 1 }],
    };
  });
  const { t, formatLocale } = useLocale();
  const handlePress = useCallback(() => onPress(index), [index, onPress]);
  const wallet = item.type === 'wallet' ? item.wallet : null;
  const theme = wallet
    ? (cardThemes[wallet.theme] ?? cardThemes[defaultCardThemeFor(wallet.walletType)])
    : null;
  const watchOnly = wallet?.walletType === 'onchain' && wallet.onchainImportMethod !== 'mnemonic';
  const gradientColors = useMemo(
    () => (theme ? walletCardGradientColors(theme.gradientColors, watchOnly) : null),
    [theme, watchOnly],
  );
  const textStyle = useMemo(() => ({ color: theme?.textColor }), [theme]);
  return (
    <View style={styles.chipSlot} testID={wallet ? undefined : 'wallet-chip-add'}>
      <Animated.View
        style={[styles.chip, highlight]}
        renderToHardwareTextureAndroid
        shouldRasterizeIOS
      >
        <TouchableOpacity
          style={styles.chipTouch}
          onPress={handlePress}
          testID={`wallet-chip-${index}`}
          accessibilityLabel={wallet?.alias ?? t('addWalletCard.addWallet')}
          accessibilityRole="button"
          accessibilityState={{ selected }}
        >
          {wallet && theme && gradientColors ? (
            <LinearGradient
              colors={gradientColors}
              start={GRADIENT_START}
              end={GRADIENT_END}
              style={styles.chipGradient}
            >
              <Text style={[styles.chipName, textStyle]} numberOfLines={1}>
                {wallet.alias}
              </Text>
              {!wallet.hideBalance && wallet.balance !== null && (
                <Text style={[styles.chipBalance, textStyle]} numberOfLines={1}>
                  {t('walletCard.satsBalance', {
                    amount: wallet.balance.toLocaleString(formatLocale),
                  })}
                </Text>
              )}
            </LinearGradient>
          ) : (
            <View style={styles.addChip}>
              <Text style={styles.plus}>+</Text>
            </View>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

export default React.memo(WalletStripChip);
