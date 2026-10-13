import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  type ViewProps,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { FlatList as GestureFlatList } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  Extrapolation,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { MiniWalletCard } from './WalletCard';
import { themeList, cardThemes, type CardThemeConfig } from '../themes/cardThemes';
import type { CardTheme } from '../types/wallet';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import {
  createWalletCardPickerStyles,
  type WalletCardPickerStyles,
  PICKER_CARD_WIDTH,
  PICKER_INTERVAL,
  PICKER_HIT_SLOP,
  PICKER_SCALES,
  PICKER_OFFSETS,
  pickerTapRegion,
} from '../styles/WalletCardPicker.styles';

interface Props {
  selectedTheme: CardTheme;
  onSelect: (theme: CardTheme) => void;
}

const DesignList = Animated.createAnimatedComponent(GestureFlatList<CardThemeConfig>);

const DEFAULT_THEME: CardTheme = 'lightning-piggy';
const DEFAULT_INDEX = Math.max(
  0,
  themeList.findIndex((theme) => theme.id === DEFAULT_THEME),
);
const CF_DEPTH = 4;
const CF_DISTANCES = [0, 1, 2, 3, 4];
const CF_SCALE_BY_DISTANCE = PICKER_SCALES;
const CF_OFFSET_BY_DISTANCE = PICKER_OFFSETS;
const designSnapOffsets = themeList.map((_, index) => index * PICKER_INTERVAL);
const themeKey = (theme: CardThemeConfig) => theme.id;
const designLayout = (_: unknown, index: number) => ({
  length: PICKER_INTERVAL,
  offset: PICKER_INTERVAL * index,
  index,
});

const DesignPreview = React.memo(
  ({
    theme,
    index,
    selected,
    centredIndex,
    onCenter,
    styles,
  }: {
    theme: CardThemeConfig;
    index: number;
    selected: boolean;
    centredIndex: number;
    onCenter: (index: number) => void;
    styles: WalletCardPickerStyles;
  }) => {
    const t = useTranslation();
    const handlePress = useCallback(() => onCenter(index), [index, onCenter]);
    const region = useMemo(() => pickerTapRegion(index, centredIndex), [index, centredIndex]);
    return (
      <View style={styles.coverflowItem}>
        <MiniWalletCard
          theme={theme}
          width={PICKER_CARD_WIDTH}
          selected={selected}
          interactive={false}
        />
        <TouchableOpacity
          style={[styles.tapTarget, region]}
          onPress={handlePress}
          disabled={region.width === 0}
          accessible={region.width > 0}
          importantForAccessibility={region.width > 0 ? 'auto' : 'no-hide-descendants'}
          testID={`theme-${theme.id}`}
          accessibilityLabel={t('walletCard.cardDesign', {
            name: theme.nameKey ? t(theme.nameKey) : theme.name,
          })}
          accessibilityRole="button"
          accessibilityState={{ selected }}
        />
      </View>
    );
  },
);
DesignPreview.displayName = 'DesignPreview';

/** Native momentum and exact snapping, with the cover-flow fan on the UI thread. */
const WalletCardPicker: React.FC<Props> = ({ selectedTheme, onSelect }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createWalletCardPickerStyles(colors), [colors]);
  const listRef = useRef<GestureFlatList<CardThemeConfig>>(null);
  const foundIndex = themeList.findIndex((theme) => theme.id === selectedTheme);
  const initialIndex = foundIndex >= 0 ? foundIndex : DEFAULT_INDEX;
  const centredTheme = themeList[initialIndex]?.id ?? selectedTheme;
  const centredConfig = cardThemes[centredTheme];
  const centredName = centredConfig?.nameKey
    ? t(centredConfig.nameKey)
    : (centredConfig?.name ?? '');
  const scrollIndex = useSharedValue(initialIndex);

  useEffect(() => {
    if (foundIndex === -1 && themeList.length > 0 && centredTheme !== selectedTheme)
      onSelect(centredTheme);
  }, [foundIndex, centredTheme, selectedTheme, onSelect]);

  useEffect(() => {
    // Parent selection can arrive after the sheet mounts. A snap callback
    // reports this same offset, so synchronising it never restarts a glide.
    listRef.current?.scrollToOffset({ offset: initialIndex * PICKER_INTERVAL, animated: false });
  }, [initialIndex]);

  const centerDesign = useCallback((index: number) => {
    listRef.current?.scrollToOffset({ offset: index * PICKER_INTERVAL, animated: true });
  }, []);
  const snapDesign = useCallback(
    (index: number) => {
      const snapped = themeList[index];
      if (snapped) onSelect(snapped.id);
    },
    [onSelect],
  );
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollIndex.value = event.contentOffset.x / PICKER_INTERVAL;
  });
  const settleDesign = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      snapDesign(Math.round(event.nativeEvent.contentOffset.x / PICKER_INTERVAL));
    },
    [snapDesign],
  );
  const endDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, velocity } = event.nativeEvent;
      const index = Math.round(contentOffset.x / PICKER_INTERVAL);
      if (velocity?.x === 0 && Math.abs(contentOffset.x - index * PICKER_INTERVAL) < 0.5)
        snapDesign(index);
    },
    [snapDesign],
  );

  // zIndex belongs on the FlatList cell itself: a zIndex inside a cell cannot
  // lift the centred card above a neighbouring sibling cell.
  const CellRenderer = useMemo(() => {
    const DesignCell = ({ index, children, style, onLayout }: ViewProps & { index: number }) => {
      const layer = useAnimatedStyle(() => {
        const value = index - scrollIndex.value;
        const dist = Math.min(Math.abs(value), CF_DEPTH);
        const scale = interpolate(dist, CF_DISTANCES, CF_SCALE_BY_DISTANCE, Extrapolation.CLAMP);
        const offset = interpolate(dist, CF_DISTANCES, CF_OFFSET_BY_DISTANCE, Extrapolation.CLAMP);
        const sign = value < 0 ? -1 : 1;
        return {
          // Native scrolling supplies the linear displacement. Apply only the
          // difference needed to compress the farther cards into the existing fan.
          transform: [
            { translateX: sign * offset * PICKER_CARD_WIDTH - value * PICKER_INTERVAL },
            { scale },
          ],
          zIndex: Math.round(CF_DEPTH - dist),
          opacity: interpolate(dist, [0, CF_DEPTH - 1, CF_DEPTH], [1, 1, 0], Extrapolation.CLAMP),
        };
      });
      return (
        <Animated.View onLayout={onLayout} hitSlop={PICKER_HIT_SLOP} style={[style, layer]}>
          {children}
        </Animated.View>
      );
    };
    return React.memo(DesignCell);
  }, [scrollIndex]);

  const renderDesign = useCallback(
    ({ item, index }: { item: CardThemeConfig; index: number }) => (
      <DesignPreview
        theme={item}
        index={index}
        selected={item.id === centredTheme}
        centredIndex={initialIndex}
        onCenter={centerDesign}
        styles={styles}
      />
    ),
    [centredTheme, initialIndex, centerDesign, styles],
  );

  return (
    <View style={styles.coverflow} testID="wallet-card-picker-coverflow" accessible={false}>
      <DesignList
        ref={listRef}
        testID="wallet-card-picker-carousel"
        accessibilityLabel={t('walletSettingsSheet.cardDesign')}
        accessible={false}
        data={themeList}
        renderItem={renderDesign}
        CellRendererComponent={CellRenderer}
        keyExtractor={themeKey}
        horizontal
        nestedScrollEnabled
        disallowInterruption
        showsHorizontalScrollIndicator={false}
        style={styles.viewport}
        contentContainerStyle={styles.listContent}
        snapToInterval={PICKER_INTERVAL}
        snapToOffsets={designSnapOffsets}
        snapToAlignment="center"
        decelerationRate="normal"
        onScroll={scrollHandler}
        onMomentumScrollEnd={settleDesign}
        onScrollEndDrag={endDrag}
        scrollEventThrottle={16}
        getItemLayout={designLayout}
        initialScrollIndex={initialIndex}
        initialNumToRender={9}
        windowSize={3}
        removeClippedSubviews={false}
      />
      <View style={styles.dots} testID="wallet-card-picker-dots">
        {themeList.map((theme) => (
          <View
            key={theme.id}
            style={[styles.dot, centredTheme === theme.id && styles.dotActive]}
          />
        ))}
      </View>
      <Text
        style={styles.name}
        testID="wallet-card-picker-name"
        accessibilityLabel={t('walletCardPicker.selectedTheme', {
          name: centredName,
        })}
      >
        {centredName}
      </Text>
    </View>
  );
};

export default React.memo(WalletCardPicker);
