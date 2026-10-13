import { Dimensions, StyleSheet } from 'react-native';
import type { Palette } from './palettes';
import { CARD_ASPECT } from './WalletCard.styles';

const SCREEN_WIDTH = Dimensions.get('window').width;
export const PICKER_CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.48);
export const PICKER_INTERVAL = PICKER_CARD_WIDTH * 0.42;
const CARD_OVERHANG = (PICKER_CARD_WIDTH - PICKER_INTERVAL) / 2;
export const PICKER_HIT_SLOP = { left: CARD_OVERHANG, right: CARD_OVERHANG };
const CARD_HEIGHT = Math.round(PICKER_CARD_WIDTH / CARD_ASPECT);
const VIEWPORT_HEIGHT = CARD_HEIGHT + 28;
export const PICKER_SCALES = [1, 0.82, 0.66, 0.54, 0.46];
export const PICKER_OFFSETS = [0, 0.42, 0.72, 0.98, 1.2];

// Only the exposed part of a fanned card is interactive. A full-card touch
// target would put its centre behind the card in front, including for Maestro.
export function pickerTapRegion(index: number, centredIndex: number) {
  const delta = index - centredIndex;
  const distance = Math.abs(delta);
  if (distance > 2) return { left: 0, width: 0 };
  if (distance === 0) return { left: -CARD_OVERHANG, width: PICKER_CARD_WIDTH };
  const direction = Math.sign(delta);
  const scale = PICKER_SCALES[distance];
  const centre = direction * PICKER_OFFSETS[distance] * PICKER_CARD_WIDTH;
  const innerCentre = direction * PICKER_OFFSETS[distance - 1] * PICKER_CARD_WIDTH;
  const halfWidth = (scale * PICKER_CARD_WIDTH) / 2;
  const innerHalfWidth = (PICKER_SCALES[distance - 1] * PICKER_CARD_WIDTH) / 2;
  const left = Math.max(
    centre - halfWidth,
    -SCREEN_WIDTH / 2,
    direction > 0 ? innerCentre + innerHalfWidth : -Infinity,
  );
  const right = Math.min(
    centre + halfWidth,
    SCREEN_WIDTH / 2,
    direction < 0 ? innerCentre - innerHalfWidth : Infinity,
  );
  return {
    left: PICKER_INTERVAL / 2 + (left - centre) / scale,
    width: Math.max(0, (right - left) / scale),
  };
}

export const createWalletCardPickerStyles = (colors: Palette) =>
  StyleSheet.create({
    // Cover-flow — a flick-through carousel with the centre card enlarged and
    // neighbours fanned/peeking on each side.
    coverflow: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewport: { width: SCREEN_WIDTH, height: VIEWPORT_HEIGHT },
    listContent: { paddingHorizontal: (SCREEN_WIDTH - PICKER_INTERVAL) / 2 },
    coverflowItem: {
      width: PICKER_INTERVAL,
      height: VIEWPORT_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tapTarget: {
      position: 'absolute',
      height: CARD_HEIGHT,
      top: (VIEWPORT_HEIGHT - CARD_HEIGHT) / 2,
    },
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
      marginTop: 12,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.divider,
    },
    dotActive: {
      width: 16,
      backgroundColor: colors.brandPink,
    },
    name: {
      marginTop: 10,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
      color: colors.textHeader,
    },
  });

export type WalletCardPickerStyles = ReturnType<typeof createWalletCardPickerStyles>;
