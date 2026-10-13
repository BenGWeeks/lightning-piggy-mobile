import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createLocationPickerSheetStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: { backgroundColor: colors.divider, width: 40 },
    // No flex:1 — dynamic sizing means content drives sheet height, not
    // the other way round.
    content: { paddingHorizontal: 16, paddingBottom: 24 },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textHeader,
      marginTop: 4,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
      marginBottom: 12,
    },
    mapWrap: {
      // Height is set inline (50% of window) so it scales with the
      // device; everything else lives here.
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    mapLoading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeButton: {
      position: 'absolute',
      top: 8,
      right: 16,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10,
    },
    coordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 12,
      marginBottom: 12,
    },
    coordText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textHeader,
    },
    coordPlaceholder: {
      fontSize: 13,
      fontStyle: 'italic',
      color: colors.textSupplementary,
    },
    confirmButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      borderRadius: 100,
      paddingVertical: 14,
    },
    confirmButtonDisabled: { opacity: 0.4 },
    confirmButtonText: { color: colors.white, fontSize: 15, fontWeight: '800' },
  });
