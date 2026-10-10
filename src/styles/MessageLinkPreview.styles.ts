import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createMessageLinkPreviewStyles = (colors: Palette, fromMe: boolean) =>
  StyleSheet.create({
    card: {
      marginTop: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: fromMe ? 'rgba(255,255,255,0.4)' : colors.brandPink,
      backgroundColor: fromMe ? 'rgba(255,255,255,0.08)' : colors.surface,
      overflow: 'hidden',
      maxWidth: 280,
    },
    tapTarget: {},
    image: {
      width: '100%',
      height: 140,
      backgroundColor: colors.background,
    },
    body: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 4,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    urlFallback: {
      flex: 1,
      fontSize: 12,
      color: fromMe ? 'rgba(255,255,255,0.85)' : colors.textSupplementary,
    },
    title: {
      fontSize: 14,
      fontWeight: '700',
      color: fromMe ? colors.white : colors.textHeader,
    },
    domain: {
      fontSize: 11,
      color: fromMe ? 'rgba(255,255,255,0.7)' : colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginTop: 2,
    },
  });
