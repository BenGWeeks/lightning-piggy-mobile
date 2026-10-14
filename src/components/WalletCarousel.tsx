import React, { useCallback } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated';
import { WalletState } from '../types/wallet';
import WalletCard from './WalletCard';
import AddWalletCard from './AddWalletCard';
import WalletCarouselDots from './WalletCarouselDots';
import { FiatCurrency } from '../services/fiatService';
import { useTranslation } from '../contexts/LocaleContext';
import { perfLog } from '../utils/perfLog';
import { walletCarouselStyles as styles, CAROUSEL_INTERVAL } from '../styles/WalletCarousel.styles';
import {
  useWalletCarousel,
  CarouselItem,
  carouselItemKey,
  carouselItemLayout,
} from '../hooks/useWalletCarousel';

let firstRenderLogged = false;

interface WalletCarouselProps {
  wallets: WalletState[];
  activeWalletId: string | null;
  btcPrice: number | null;
  currency: FiatCurrency;
  onWalletChange: (walletId: string | null) => void;
  onAddWallet: () => void;
  onSettingsPress: (walletId: string) => void;
  onAddCardActiveChange?: (active: boolean) => void;
}

const WalletRow = React.memo(
  ({
    wallet,
    btcPrice,
    currency,
    onSettingsPress,
  }: {
    wallet: WalletState;
    btcPrice: number | null;
    currency: FiatCurrency;
    onSettingsPress: (id: string) => void;
  }) => {
    const handleSettings = useCallback(
      () => onSettingsPress(wallet.id),
      [onSettingsPress, wallet.id],
    );
    return (
      <WalletCard
        carousel
        wallet={wallet}
        btcPrice={btcPrice}
        currency={currency}
        onSettingsPress={handleSettings}
      />
    );
  },
);

WalletRow.displayName = 'WalletRow';

const WalletCarousel: React.FC<WalletCarouselProps> = ({
  wallets,
  activeWalletId,
  btcPrice,
  currency,
  onWalletChange,
  onAddWallet,
  onSettingsPress,
  onAddCardActiveChange,
}) => {
  if (!firstRenderLogged) {
    firstRenderLogged = true;
    perfLog(`WalletCarousel first render (${wallets.length} wallets)`);
  }
  const t = useTranslation();
  const carousel = useWalletCarousel(
    wallets,
    activeWalletId,
    onWalletChange,
    onAddCardActiveChange,
  );
  const { scrollToIndex, onScrollBeginDrag, onMomentumScrollEnd } = carousel;
  // Highlight dots on the UI thread; React and wallet context update only at rest.
  const scrollIndex = useSharedValue(carousel.initialIndex);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollIndex.value = Math.round(event.contentOffset.x / CAROUSEL_INTERVAL);
    },
    onBeginDrag: () => runOnJS(onScrollBeginDrag)(),
    onEndDrag: (event) => {
      // A slow drag can stop exactly on a snap without a momentum phase.
      const offset = event.contentOffset.x;
      const snapped = Math.round(offset / CAROUSEL_INTERVAL) * CAROUSEL_INTERVAL;
      if (event.velocity?.x === 0 && Math.abs(offset - snapped) < 0.5)
        runOnJS(onMomentumScrollEnd)({ nativeEvent: event });
    },
  });
  const handleAddWallet = useCallback(() => {
    // A user can tap the peeking add card before it becomes the active page.
    scrollToIndex(wallets.length);
    onAddWallet();
  }, [scrollToIndex, wallets.length, onAddWallet]);
  const renderItem = useCallback(
    ({ item, index }: { item: CarouselItem; index: number }) => (
      <View
        style={styles.page}
        renderToHardwareTextureAndroid
        shouldRasterizeIOS
        testID={`wallet-carousel-page-${index}`}
        accessibilityState={{ selected: index === carousel.currentIndex }}
      >
        {item.type === 'add' ? (
          <AddWalletCard carousel onPress={handleAddWallet} />
        ) : (
          <WalletRow
            wallet={item.wallet}
            btcPrice={btcPrice}
            currency={currency}
            onSettingsPress={onSettingsPress}
          />
        )}
      </View>
    ),
    [btcPrice, currency, handleAddWallet, onSettingsPress, carousel.currentIndex],
  );

  return (
    <View style={styles.container}>
      <Animated.FlatList
        ref={carousel.flatListRef}
        testID="wallet-carousel"
        accessibilityLabel={t('tabs.wallets')}
        accessible={false}
        data={carousel.data}
        renderItem={renderItem}
        keyExtractor={carouselItemKey}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CAROUSEL_INTERVAL}
        snapToOffsets={carousel.snapToOffsets}
        snapToAlignment="center"
        decelerationRate="normal"
        onScroll={scrollHandler}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={16}
        onViewableItemsChanged={carousel.onViewableItemsChanged}
        viewabilityConfig={carousel.viewabilityConfig}
        contentContainerStyle={styles.listContent}
        getItemLayout={carouselItemLayout}
        initialScrollIndex={carousel.initialIndex}
      />
      <WalletCarouselDots
        count={carousel.data.length}
        currentIndex={carousel.currentIndex}
        scrollIndex={scrollIndex}
      />
    </View>
  );
};

export default React.memo(WalletCarousel);
