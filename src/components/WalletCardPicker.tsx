import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, Dimensions } from 'react-native';
import { interpolate, Extrapolation } from 'react-native-reanimated';
import Carousel, { type ICarouselInstance } from 'react-native-reanimated-carousel';
import { MiniWalletCard, CARD_ASPECT } from './WalletCard';
import { themeList, cardThemes } from '../themes/cardThemes';
import type { CardTheme } from '../types/wallet';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
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
// A hand-driven cover flow: the centre (selected) card is drawn large and
// z-raised, and its neighbours shrink AND draw closer together the further out
// they sit, so the deck reads as "big centre → a good peek of the immediate
// neighbours → progressively thinner slivers beyond". The per-distance scale
// and offset ramps below are applied by `coverFlowAnimation` (a worklet) rather
// than the carousel's flat `parallax` mode, which could only give every
// neighbour a single identical scale. Revisit the ramps against fresh
// screenshots if the fan reads too tight/loose or the centre doesn't dominate.
const CF_CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.48); // centre card base width
const CF_CARD_HEIGHT = Math.round(CF_CARD_WIDTH / CARD_ASPECT);
// Room for the enlarged centre card plus a little breathing space.
const CF_VIEWPORT_HEIGHT = CF_CARD_HEIGHT + 28;
// How many cards deep the fan is drawn on each side before they fade out. The
// ramps below are sampled at integer distances 0..CF_DEPTH.
const CF_DEPTH = 4;
// Scale per integer distance from centre (0 = centre). The step from 0→1 is
// deliberately gentle so the immediate neighbours stay substantial ("see a
// little more of them"), then it falls off faster so far cards become slivers.
const CF_SCALE_BY_DISTANCE = [1, 0.82, 0.66, 0.54, 0.46];
// Centre-to-centre horizontal offset per integer distance, in units of
// CF_CARD_WIDTH. The immediate neighbour sits well out (0.42·cardWidth) so a
// generous slice of it shows past the enlarged centre card (~0.17·screen of
// peek); each further step then adds a SMALLER increment (0.30 → 0.26 → 0.22)
// so the fan compresses outward and every card shows a little less than the one
// before it, trailing off into slivers at the viewport edge.
const CF_OFFSET_BY_DISTANCE = [0, 0.42, 0.72, 0.98, 1.2];
// Render the centre card + 2 neighbours on each side (5 total). Cards beyond
// that are clipped by the carousel's overflow:hidden and are never actually
// visible, so rendering all ~20 themes at once adds unnecessary work and can
// hurt swipe smoothness. 5 covers the full visible fan depth (CF_DEPTH = 4)
// with a 1-card pre-render buffer, matching the recommended FlatList pattern.
const CF_WINDOW_SIZE = 5;

// Distance sample points [0,1,2,3,4] shared by both interpolation ramps.
const CF_DISTANCES = CF_SCALE_BY_DISTANCE.map((_, i) => i);

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
  const t = useTranslation();
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

  // Cover-flow transform per card, driven by `value` = signed distance from the
  // focused card (0 = centre, ±1 = immediate neighbour, fractional mid-swipe).
  // Scale and horizontal offset both ramp with |distance| so the centre stays
  // big while neighbours shrink and pack tighter outward; the centre is z-raised
  // above its neighbours and far cards fade out at the fan's edge.
  const coverFlowAnimation = useCallback((value: number) => {
    'worklet';
    const dist = Math.min(Math.abs(value), CF_DEPTH);
    const scale = interpolate(dist, CF_DISTANCES, CF_SCALE_BY_DISTANCE, Extrapolation.CLAMP);
    const offsetUnits = interpolate(dist, CF_DISTANCES, CF_OFFSET_BY_DISTANCE, Extrapolation.CLAMP);
    const sign = value < 0 ? -1 : 1;
    const translateX = sign * offsetUnits * CF_CARD_WIDTH;
    const opacity = interpolate(dist, [0, CF_DEPTH - 1, CF_DEPTH], [1, 1, 0], Extrapolation.CLAMP);
    return {
      transform: [{ translateX }, { scale }],
      opacity,
      zIndex: Math.round(CF_DEPTH - dist),
    };
  }, []);

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
        customAnimation={coverFlowAnimation}
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
          name: cardThemes[centredTheme]?.name ?? '',
        })}
      >
        {cardThemes[centredTheme]?.name ?? ''}
      </Text>
    </View>
  );
};

export default WalletCardPicker;
