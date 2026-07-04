import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createSendModeTabsStyles = (colors: Palette) =>
  StyleSheet.create({
    tabRow: {
      flexDirection: 'row',
      backgroundColor: colors.divider,
      borderRadius: 10,
      padding: 3,
    },
    tab: {
      paddingHorizontal: 24,
      paddingVertical: 8,
      borderRadius: 8,
    },
    tabActive: {
      backgroundColor: colors.surface,
    },
  });
