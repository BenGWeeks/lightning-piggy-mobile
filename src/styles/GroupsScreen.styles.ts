import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createGroupsScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.brandPink,
    },
    bgImage: {
      position: 'absolute',
      width: '120%',
      height: 420,
      right: -40,
      top: -20,
      opacity: 0.15,
    },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.9)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    addButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.2)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      color: colors.white,
      fontSize: 28,
      fontWeight: '700',
    },
    content: {
      flex: 1,
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      marginTop: -24,
    },
    filterChipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
      marginLeft: 16,
    },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: 'rgba(229, 34, 120, 0.1)',
    },
    filterChipOff: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
      borderWidth: 1,
      borderColor: 'rgba(0, 0, 0, 0.1)',
    },
    filterChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.brandPink,
    },
    filterChipTextOff: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    listContent: {
      paddingTop: 12,
      paddingBottom: 20,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 12,
    },
    info: {
      flex: 1,
    },
    name: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textHeader,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    emptyState: {
      padding: 40,
      alignItems: 'center',
      gap: 8,
      marginTop: 40,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
    },
    emptySubtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
    emptyButton: {
      backgroundColor: colors.brandPink,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
      marginTop: 8,
    },
    emptyButtonText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
  });
