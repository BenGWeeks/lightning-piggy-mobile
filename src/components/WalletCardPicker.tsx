import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Dimensions } from 'react-native';
import Carousel, { type ICarouselInstance } from 'react-native-reanimated-carousel';
import { MiniWalletCard, CARD_ASPECT } from './WalletCard';
import { themeList, cardThemes } from '../themes/cardThemes';
import type { CardTheme } from '../types/wallet';
import { useThemeColors } from '../contexts/ThemeContext';
import { createWalletCardPickerStyles } from '../styles/WalletCardPicker.styles';

interface Props {
  selectedTheme: CardTheme;
  onSelect: (theme: CardTheme) => void;
  /**
   * `grid` — the original 2-up wrapping grid (used where vertical space is
   * cheap; currently WalletSettingsSheet). `coverflow` — a flick-through
   * carousel with the centre card full and neighbours peeking (currently the
   * add-wallet theme step).
   */
  variant?: 'grid' | 'coverflow';
}

const SCREEN_WIDTH = Dimensions.get('window').width;
// The full card size in the cover-flow (centre item). Neighbours are scaled
// down by the parallax config so a slice of each peeks in.
const CF_CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.52);
const CF_CARD_HEIGHT = Math.round(CF_CARD_WIDTH / CARD_ASPECT);
const CF_VIEWPORT_HEIGHT = CF_CARD_HEIGHT + 24;

/**
 * Shared wallet card-design picker. Extracted from the byte-identical grids
 * that WalletSettingsSheet and AddWalletWizard used to each paste in (#703
 * pattern) so the design list, selection contract and layout live in one
 * place; the visual is a one-line `variant` prop.
 */
const WalletCardPicker: React.FC<Props> = ({ selectedTheme, onSelect, variant = 'grid' }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createWalletCardPickerStyles(colors), [colors]);
  const carouselRef = useRef<ICarouselInstance>(null);

  const foundIndex = themeList.findIndex((t) => t.id === selectedTheme);
  // Persisted wallets may carry a theme key that no longer exists (see the
  // WalletCard.tsx fallback note). In coverflow the carousel visually falls
  // back to index 0, so normalise the parent's `selectedTheme` back to that
  // shown card — otherwise parent state (and any Save/Next) keeps a stale key
  // while a different card is centred. Guarded to only fire when they differ,
  // so it can't loop (once synced, `foundIndex` resolves and the branch exits).
  useEffect(() => {
    if (variant !== 'coverflow') return;
    if (foundIndex === -1 && themeList.length > 0) {
      const fallback = themeList[0].id;
      if (fallback !== selectedTheme) onSelect(fallback);
    }
  }, [variant, foundIndex, selectedTheme, onSelect]);

  if (variant === 'grid') {
    return (
      <View style={styles.grid} testID="wallet-card-picker-grid">
        {themeList.map((theme) => (
          <MiniWalletCard
            key={theme.id}
            theme={theme}
            selected={selectedTheme === theme.id}
            onPress={() => onSelect(theme.id)}
          />
        ))}
      </View>
    );
  }

  const initialIndex = Math.max(0, foundIndex);
  // When `selectedTheme` isn't in `themeList` the carousel falls back to index
  // 0, so derive the label/active state from the actually-centred card rather
  // than the stale `selectedTheme` (the effect above also syncs it to parent).
  const centredTheme = themeList[initialIndex]?.id ?? selectedTheme;

  return (
    <View style={styles.coverflow} testID="wallet-card-picker-coverflow">
      <Carousel
        ref={carouselRef}
        width={SCREEN_WIDTH}
        height={CF_VIEWPORT_HEIGHT}
        data={themeList}
        defaultIndex={initialIndex}
        loop={false}
        mode="parallax"
        modeConfig={{
          parallaxScrollingScale: 0.9,
          parallaxScrollingOffset: SCREEN_WIDTH - CF_CARD_WIDTH - 24,
          parallaxAdjacentItemScale: 0.74,
        }}
        onSnapToItem={(index) => onSelect(themeList[index].id)}
        renderItem={({ item, index }) => (
          <View style={styles.coverflowItem}>
            <MiniWalletCard
              theme={item}
              width={CF_CARD_WIDTH}
              selected={item.id === centredTheme}
              // Tapping a side card scrolls it to centre; the snap then
              // commits the selection via onSnapToItem.
              onPress={() => carouselRef.current?.scrollTo({ index, animated: true })}
            />
          </View>
        )}
      />
      {/* Page dots + the centred card's name. */}
      <View style={styles.dots}>
        {themeList.map((theme) => (
          <View
            key={theme.id}
            style={[styles.dot, centredTheme === theme.id && styles.dotActive]}
          />
        ))}
      </View>
      <Text style={styles.name}>{cardThemes[centredTheme]?.name ?? ''}</Text>
    </View>
  );
};

export default WalletCardPicker;
