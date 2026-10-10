import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createConversationComposerStyles = (
  colors: Palette,
  opts: { paddingHorizontal: number; attachButtonHasBackground: boolean },
) =>
  StyleSheet.create({
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: opts.paddingHorizontal,
      paddingTop: 8,
      gap: 8,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    // "Editing message" bar above the input row (#1237).
    editBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: opts.paddingHorizontal + 6,
      paddingVertical: 8,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      borderLeftWidth: 3,
      borderLeftColor: colors.brandPink,
    },
    editBannerText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '700',
      color: colors.brandPink,
    },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 120,
      backgroundColor: colors.background,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 10,
      fontSize: 15,
      color: colors.textBody,
    },
    attachButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: opts.attachButtonHasBackground ? colors.background : 'transparent',
    },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendButtonLarge: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendButtonDisabled: {
      opacity: 0.4,
    },
  });
