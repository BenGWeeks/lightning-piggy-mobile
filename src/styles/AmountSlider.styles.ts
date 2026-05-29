import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

// Geometry shared with the component's drag math — keep in sync.
export const THUMB_SIZE = 30;
const TRACK_H = 8;
const CONTAINER_H = 44;

// Bold, app-themed amount slider: a thick pink track + a large circular thumb
// with a white ring + shadow so it reads as a draggable control (the stock
// @react-native-community/slider thumb was too thin / off-brand). #341.
export const createAmountSliderStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { width: '100%', height: CONTAINER_H, marginTop: 4, justifyContent: 'center' },
    track: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: (CONTAINER_H - TRACK_H) / 2,
      height: TRACK_H,
      borderRadius: TRACK_H / 2,
      backgroundColor: colors.brandPinkLight,
    },
    fill: {
      position: 'absolute',
      left: 0,
      top: (CONTAINER_H - TRACK_H) / 2,
      height: TRACK_H,
      borderRadius: TRACK_H / 2,
      backgroundColor: colors.brandPink,
    },
    thumb: {
      position: 'absolute',
      top: (CONTAINER_H - THUMB_SIZE) / 2,
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      borderRadius: THUMB_SIZE / 2,
      backgroundColor: colors.brandPink,
      borderWidth: 3,
      borderColor: colors.white,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 4,
    },
  });

export type AmountSliderStyles = ReturnType<typeof createAmountSliderStyles>;
