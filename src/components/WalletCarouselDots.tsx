import React from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useTranslation } from '../contexts/LocaleContext';
import {
  walletCarouselStyles as styles,
  DOT_ACTIVE_COLOR,
  DOT_INACTIVE_COLOR,
} from '../styles/WalletCarousel.styles';

interface DotProps {
  index: number;
  total: number;
  selected: boolean;
  scrollIndex: SharedValue<number>;
}

// The highlight follows the scroll position on the UI thread, so a fling moves
// the active dot without a React render per frame. `selected` is the settled
// card, committed on momentum end, and is what accessibility and Maestro read.
const CarouselDot = React.memo(({ index, total, selected, scrollIndex }: DotProps) => {
  const t = useTranslation();
  const highlight = useAnimatedStyle(() => ({
    backgroundColor: scrollIndex.value === index ? DOT_ACTIVE_COLOR : DOT_INACTIVE_COLOR,
  }));
  return (
    <Animated.View
      style={[styles.dot, highlight]}
      testID={`wallet-carousel-dot-${index}`}
      accessibilityLabel={t('walletCard.carouselPosition', { current: index + 1, total })}
      accessibilityState={{ selected }}
    />
  );
});

CarouselDot.displayName = 'CarouselDot';

interface Props {
  count: number;
  currentIndex: number;
  scrollIndex: SharedValue<number>;
}

const WalletCarouselDots = ({ count, currentIndex, scrollIndex }: Props) => {
  if (count <= 1) return null;
  return (
    <View style={styles.dots} testID="wallet-carousel-dots">
      {Array.from({ length: count }, (_, index) => (
        <CarouselDot
          key={index}
          index={index}
          total={count}
          selected={index === currentIndex}
          scrollIndex={scrollIndex}
        />
      ))}
    </View>
  );
};

export default React.memo(WalletCarouselDots);
