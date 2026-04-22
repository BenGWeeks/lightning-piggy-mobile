import React, { useRef, useCallback, useState } from 'react';
import { View, FlatList, StyleSheet, ViewToken } from 'react-native';
import { WalletState } from '../types/wallet';
import WalletCard, { CARD_WIDTH, CARD_MARGIN } from './WalletCard';
import AddWalletCard from './AddWalletCard';
import { FiatCurrency } from '../services/fiatService';

const SNAP_INTERVAL = CARD_WIDTH + CARD_MARGIN * 2;

interface WalletCarouselProps {
  wallets: WalletState[];
  activeWalletId: string | null;
  btcPrice: number | null;
  currency: FiatCurrency;
  onWalletChange: (walletId: string | null) => void;
  onAddWallet: () => void;
  onSettingsPress: (walletId: string) => void;
}

type CarouselItem = { type: 'wallet'; wallet: WalletState } | { type: 'add' };

const WalletCarousel: React.FC<WalletCarouselProps> = ({
  wallets,
  activeWalletId,
  btcPrice,
  currency,
  onWalletChange,
  onAddWallet,
  onSettingsPress,
}) => {
  const flatListRef = useRef<FlatList>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const data: CarouselItem[] = [
    ...wallets.map((wallet): CarouselItem => ({ type: 'wallet', wallet })),
    { type: 'add' },
  ];

  const activeIndex = wallets.findIndex((w) => w.id === activeWalletId);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length === 0) return;
      const index = viewableItems[0].index ?? 0;
      setCurrentIndex(index);
      const item = viewableItems[0].item as CarouselItem;
      if (item.type === 'wallet') {
        onWalletChange(item.wallet.id);
      } else {
        onWalletChange(null);
      }
    },
    [onWalletChange],
  );

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const renderItem = useCallback(
    ({ item }: { item: CarouselItem }) => {
      if (item.type === 'add') {
        return <AddWalletCard onPress={onAddWallet} />;
      }
      return (
        <WalletCard
          wallet={item.wallet}
          btcPrice={btcPrice}
          currency={currency}
          onSettingsPress={() => onSettingsPress(item.wallet.id)}
        />
      );
    },
    [btcPrice, currency, onAddWallet, onSettingsPress],
  );

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={data}
        renderItem={renderItem}
        keyExtractor={(item, index) => (item.type === 'wallet' ? item.wallet.id : `add-${index}`)}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP_INTERVAL}
        snapToAlignment="start"
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        contentContainerStyle={styles.listContent}
        getItemLayout={(_, index) => ({
          length: SNAP_INTERVAL,
          offset: SNAP_INTERVAL * index,
          index,
        })}
        initialScrollIndex={activeIndex >= 0 ? activeIndex : 0}
      />

      {/* Dot indicators */}
      <View style={styles.dots}>
        {data.map((_, index) => (
          <View
            key={index}
            style={[styles.dot, index === currentIndex ? styles.dotActive : styles.dotInactive]}
          />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
  },
  listContent: {},
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    paddingBottom: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
  },
  dotInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
});

export default WalletCarousel;
