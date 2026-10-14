import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Seller Orders screen (#1534) and its order rows. */
export const createMarketShopOrdersStyles = (colors: Palette) =>
  StyleSheet.create({
    row: {
      marginHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    avatarImage: { width: 44, height: 44, borderRadius: 22 },
    avatarInitial: { fontSize: 18, fontWeight: '700', color: colors.brandPink },
    body: { flex: 1, minWidth: 0, gap: 2 },
    topRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    name: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textHeader },
    time: { fontSize: 12, color: colors.textSupplementary },
    items: { fontSize: 14, color: colors.textBody },
    amount: { fontSize: 13, fontWeight: '600', color: colors.brandPink },
    accessory: { marginTop: 6 },
    empty: { alignItems: 'center', gap: 8, paddingHorizontal: 32, paddingTop: 48 },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textHeader },
    emptyBody: { fontSize: 14, color: colors.textSupplementary, textAlign: 'center' },
    listHeader: { padding: 16, paddingBottom: 10 },
  });

export type MarketShopOrdersStyles = ReturnType<typeof createMarketShopOrdersStyles>;
