import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createExploreHomeScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerBackground: {
      minHeight: 140,
      paddingBottom: 8,
      backgroundColor: colors.brandPink,
      overflow: 'hidden',
    },
    headerExtras: {
      paddingHorizontal: 20,
      paddingTop: 6,
    },
    tagline: {
      color: 'rgba(255,255,255,0.85)',
      fontSize: 13,
      fontWeight: '500',
    },
    scrollArea: {
      flex: 1,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      padding: 16,
      gap: 16,
    },
    card: {
      width: '47%',
      backgroundColor: colors.surface,
      borderRadius: 12,
      overflow: 'hidden',
      paddingBottom: 14,
    },
    cardTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
      paddingHorizontal: 12,
      paddingTop: 10,
    },
    chipSpacer: {
      flex: 1,
    },
    chip: {
      marginHorizontal: 12,
      backgroundColor: colors.brandPinkLight,
      paddingHorizontal: 14,
      height: 26,
      justifyContent: 'center',
      borderRadius: 100,
      alignSelf: 'flex-start',
    },
    chipText: {
      color: colors.brandPink,
      fontSize: 11,
      fontWeight: '700',
    },
  });
