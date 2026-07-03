import React, { useMemo, useRef } from 'react';
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
   * cheap). `coverflow` — a flick-through carousel with the centre card full
   * and neighbours peeking (the wallet-settings Design tab + the add-wallet
   * theme step).
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

  const initialIndex = Math.max(
    0,
    themeList.findIndex((t) => t.id === selectedTheme),
  );

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
              selected={item.id === selectedTheme}
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
            style={[styles.dot, selectedTheme === theme.id && styles.dotActive]}
          />
        ))}
      </View>
      <Text style={styles.name}>{cardThemes[selectedTheme]?.name ?? ''}</Text>
    </View>
  );
};

export default WalletCardPicker;
