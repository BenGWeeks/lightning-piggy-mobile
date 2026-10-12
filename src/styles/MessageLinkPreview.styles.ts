import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createMessageLinkPreviewStyles = (colors: Palette, fromMe: boolean) =>
  StyleSheet.create({
    card: {
      marginTop: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: fromMe ? colors.outgoingBubble.foreground : colors.brandPink,
      backgroundColor: fromMe ? 'rgba(0,0,0,0.08)' : colors.surface,
      overflow: 'hidden',
      maxWidth: 280,
    },
    tapTarget: {},
    image: {
      width: '100%',
      backgroundColor: fromMe ? 'rgba(0,0,0,0.08)' : colors.surface,
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
      color: fromMe ? colors.outgoingBubble.foreground : colors.textSupplementary,
    },
    title: {
      fontSize: 14,
      fontWeight: '700',
      color: fromMe ? colors.outgoingBubble.foreground : colors.textHeader,
    },
    domain: {
      fontSize: 11,
      color: fromMe ? colors.outgoingBubble.foreground : colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginTop: 2,
    },
  });

export const createLinkPreviewImageSizeStyles = (aspectRatio: number) =>
  StyleSheet.create({ image: { aspectRatio } });
