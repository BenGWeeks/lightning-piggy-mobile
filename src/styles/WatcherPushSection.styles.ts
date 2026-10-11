import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createWatcherPushSectionStyles = (_colors: Palette) =>
  StyleSheet.create({
    disabled: {
      opacity: 0.7,
    },
  });

export type WatcherPushSectionStyles = ReturnType<typeof createWatcherPushSectionStyles>;
