import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createAttachPanelStyles = (colors: Palette) =>
  StyleSheet.create({
    panel: {
      // Intrinsic-sized: the 4-col grid drives the panel's height, so
      // we don't have to guess a keyboard height to fit. Sits above
      // the composer inside KeyboardStickyView; opening it dismisses
      // the IME (handled in ConversationScreen) so the panel + composer
      // stack never has to also accommodate the keyboard.
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      // 4 columns: each tile claims 25 % of the row width. The
      // negative gap is replaced by per-tile bottom margin so wrapping
      // doesn't leave hanging horizontal gaps.
    },
    tile: {
      width: '25%',
      alignItems: 'center',
      marginBottom: 16,
      gap: 6,
    },
    tileDisabled: {
      opacity: 0.4,
    },
    iconCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      color: colors.textBody,
      fontSize: 12,
      fontWeight: '600',
    },
  });
