import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import BrandGradientBackground from './BrandGradientBackground';
import { useThemeColors } from '../contexts/ThemeContext';
import { createWalletHeaderBackdropStyles } from '../styles/WalletHeaderBackdrop.styles';

const PIG_IMAGE = require('../../assets/images/lightning-piggy-intro.png');

// Composite the two static background layers once. Scrolling wallet cards
// should reuse that texture rather than blend the translucent pig every frame.
const WalletHeaderBackdrop = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createWalletHeaderBackdropStyles(colors), [colors]);
  return (
    <View
      pointerEvents="none"
      accessible={false}
      style={styles.fill}
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
    >
      <BrandGradientBackground />
      <Image source={PIG_IMAGE} style={styles.pig} contentFit="contain" cachePolicy="memory-disk" />
    </View>
  );
};

export default React.memo(WalletHeaderBackdrop);
