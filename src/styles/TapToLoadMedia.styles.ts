import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

// Presentation for the tap-to-load placeholder shown in place of chat media
// from senders the reader doesn't follow (#1338). `fromMe` mirrors the
// link-preview card's on-pink treatment, though own messages never gate.
export const createTapToLoadMediaStyles = (colors: Palette, fromMe: boolean) =>
  StyleSheet.create({
    // Link-preview variant: a card the same shape as MessageLinkPreview.
    previewCard: {
      marginTop: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: fromMe ? 'rgba(255,255,255,0.4)' : colors.brandPink,
      backgroundColor: fromMe ? 'rgba(255,255,255,0.08)' : colors.surface,
      maxWidth: 280,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    // Image variant: fills the bubble; the caller supplies the bounded aspect.
    imageBox: {
      width: '100%',
      aspectRatio: 1,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
      gap: 6,
    },
    // Thumb variant: fills a profile thumbnail / media tile.
    thumbBox: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 6,
      gap: 4,
    },
    thumbLabel: {
      fontSize: 11,
      fontWeight: '600',
      textAlign: 'center',
      color: colors.textHeader,
    },
    textCol: {
      flexShrink: 1,
      gap: 2,
    },
    label: {
      fontSize: 14,
      fontWeight: '700',
      color: fromMe ? colors.white : colors.textHeader,
    },
    labelCentered: {
      textAlign: 'center',
    },
    host: {
      fontSize: 12,
      color: fromMe ? 'rgba(255,255,255,0.75)' : colors.textSupplementary,
    },
  });
