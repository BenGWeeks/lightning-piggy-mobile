import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Styles for {@link MarketListingActions} and {@link MarketShareSheet}. */
export const createMarketListingActionsStyles = (colors: Palette) =>
  StyleSheet.create({
    // Right-aligned under the product image, like Amazon's heart + share.
    row: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 8,
    },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minWidth: 40,
      minHeight: 40,
      paddingHorizontal: 8,
      borderRadius: 20,
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    count: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textBody,
    },
    // ----- share sheet ----------------------------------------------------
    sheet: {
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    sheetTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 4,
      marginBottom: 8,
    },
    sheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    sheetRowText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textHeader,
    },
  });

export type MarketListingActionsStyles = ReturnType<typeof createMarketListingActionsStyles>;
