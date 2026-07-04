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
}

const SCREEN_WIDTH = Dimensions.get('window').width;

// Unknown / stale theme keys fall back to a *stable* default card rather than
// `themeList[0]`: since `themeList` is now sorted alphabetically by display name
// (see cardThemes.ts), index 0 is arbitrary (currently "Alby"). Lightning Piggy
// is the app's canonical default card, so both the carousel's centred card and
// the value we normalise parent state to resolve to it deterministically.
const DEFAULT_THEME: CardTheme = 'lightning-piggy';
const DEFAULT_INDEX = Math.max(
  0,
  themeList.findIndex((t) => t.id === DEFAULT_THEME),
);

// --- Cover-flow geometry -----------------------------------------------------
// The centre (selected) card is drawn full-size and z-raised; its neighbours
// are shrunk and packed with heavy overlap so ~9 cards fan across the viewport
// at once (the centre plus ~4 peeking to each side). These are hand-tuned
// constants — revisit them against fresh screenshots if the fan reads too
// tight/loose or the centre doesn't stand out enough.
const CF_CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.44); // centre card base width
const CF_CARD_HEIGHT = Math.round(CF_CARD_WIDTH / CARD_ASPECT);
const CF_VIEWPORT_HEIGHT = CF_CARD_HEIGHT + 24;
// Centre-to-centre distance between adjacent cards. The parallax layout places
// neighbour n at ±n·(SCREEN_WIDTH − parallaxScrollingOffset), so this constant
// IS that spacing and the offset is derived from it. At ~0.25·cardWidth
// (≈0.11·screen) the cards overlap heavily and ~9 fit across the viewport.
const CF_CARD_SPACING = Math.round(CF_CARD_WIDTH * 0.25);
// Focused card at full size; neighbours notably smaller so the centre pops.
const CF_CENTER_SCALE = 1.0;
const CF_ADJACENT_SCALE = 0.72;
// Mount every card so the fanned deck is fully populated — there are only a
// handful of designs, so this is cheap, and anything beyond the viewport is
// clipped by the carousel's overflow:hidden.
const CF_WINDOW_SIZE = themeList.length;

/**
 * Shared wallet card-design picker — a flick-through cover-flow with the
 * centre (selected) card enlarged and z-raised while neighbours fan out and
 * peek on each side. Extracted from the byte-identical grids that
 * WalletSettingsSheet and AddWalletWizard used to each paste in (#703 pattern)
 * so the design list, selection contract and layout live in one place. Used in
 * both the add-wallet wizard's theme step and the wallet-settings Design
 * section — cover-flow everywhere; there is no longer a grid variant.
 */
const WalletCardPicker: React.FC<Props> = ({ selectedTheme, onSelect }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createWalletCardPickerStyles(colors), [colors]);
  const carouselRef = useRef<ICarouselInstance>(null);

  const foundIndex = themeList.findIndex((t) => t.id === selectedTheme);
  // Persisted wallets may carry a theme key that no longer exists (see the
  // WalletCard.tsx fallback note). The carousel visually falls back to the
  // stable DEFAULT_INDEX, so normalise the parent's `selectedTheme` back to
  // that shown card — otherwise parent state (and any Save/Next) keeps a stale
  // key while a different card is centred. Guarded to only fire when they
  // differ, so it can't loop (once synced, `foundIndex` resolves and the
  // branch exits).
  useEffect(() => {
    if (foundIndex === -1 && themeList.length > 0) {
      const fallback = themeList[DEFAULT_INDEX].id;
      if (fallback !== selectedTheme) onSelect(fallback);
    }
  }, [foundIndex, selectedTheme, onSelect]);

  // `defaultIndex` only positions the carousel on mount. When the parent
  // changes `selectedTheme` *after* mount (e.g. WalletSettingsSheet sets it in
  // a useEffect once the wallet loads), scroll the carousel to the new card so
  // the centred card, dots and label stay in sync with parent state.
  // `scrollTo` no-ops when the target equals the current index, so this can't
  // fight an in-progress user swipe (which already leaves them equal).
  useEffect(() => {
    if (foundIndex >= 0) {
      carouselRef.current?.scrollTo({ index: foundIndex, animated: false });
    }
  }, [foundIndex]);

  const initialIndex = foundIndex >= 0 ? foundIndex : DEFAULT_INDEX;
  // When `selectedTheme` isn't in `themeList` the carousel falls back to
  // DEFAULT_INDEX, so derive the label/active state from the actually-centred
  // card rather than the stale `selectedTheme` (the effect above also syncs it
  // to parent).
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
        windowSize={CF_WINDOW_SIZE}
        mode="parallax"
        modeConfig={{
          parallaxScrollingScale: CF_CENTER_SCALE,
          parallaxScrollingOffset: SCREEN_WIDTH - CF_CARD_SPACING,
          parallaxAdjacentItemScale: CF_ADJACENT_SCALE,
        }}
        onSnapToItem={(index) => {
          // Guard the lookup: a future refactor could empty themeList or the
          // carousel could report an out-of-range index — don't throw on `.id`.
          const snapped = themeList[index];
          if (snapped) onSelect(snapped.id);
        }}
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
