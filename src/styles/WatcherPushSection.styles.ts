import { StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createWatcherPushSectionStyles = (colors: Palette) =>
  StyleSheet.create({
    subHeader: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
      marginTop: 18,
    },
    disabled: {
      opacity: 0.7,
    },
  });

export type WatcherPushSectionStyles = ReturnType<typeof createWatcherPushSectionStyles>;
