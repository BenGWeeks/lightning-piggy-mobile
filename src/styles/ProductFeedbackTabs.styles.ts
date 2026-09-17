import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createProductFeedbackTabsStyles = (colors: Palette) =>
  StyleSheet.create({
    tabBar: {
      flexDirection: 'row',
      gap: 24,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      marginBottom: 16,
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingBottom: 10,
      paddingTop: 4,
      marginBottom: -1,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabActive: {
      borderBottomColor: colors.brandPink,
    },
    tabLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    tabLabelActive: {
      color: colors.textHeader,
      fontWeight: '800',
    },
    body: {
      marginTop: 4,
    },
    visible: {
      display: 'flex',
    },
    hidden: {
      display: 'none',
    },
  });

export type ProductFeedbackTabsStyles = ReturnType<typeof createProductFeedbackTabsStyles>;
