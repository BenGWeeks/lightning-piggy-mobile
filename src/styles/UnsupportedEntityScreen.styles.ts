import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createUnsupportedEntityScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.brandPink,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerRightSpacer: { width: 24 },
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 16,
    },
    piggy: { width: 160, height: 160, marginBottom: 8 },
    title: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.textHeader,
      textAlign: 'center',
    },
    message: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSupplementary,
      textAlign: 'center',
      marginBottom: 8,
    },
    walletsButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      paddingVertical: 14,
      paddingHorizontal: 32,
      borderRadius: 100,
    },
    walletsButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  });
