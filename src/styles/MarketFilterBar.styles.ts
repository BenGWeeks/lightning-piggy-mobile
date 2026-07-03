import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/** Styles for {@link MarketFilterBar} — the right-anchored, slide-in filter
 * panel housing the merchant / country / currency chip sections. Selected
 * chips fill brand-pink to match {@link createMarketModeSelectorStyles}, so the
 * filter controls read as siblings of the marketplace-mode selector. The search
 * box no longer lives here — it stays inline in the Market header (see
 * {@link createMarketScreenStyles}). */
export const createMarketFilterBarStyles = (colors: Palette) =>
  StyleSheet.create({
    // ----- panel shell -----------------------------------------------------
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    // Right-anchored drawer spanning the full height; slides in via translateX.
    panel: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      right: 0,
      backgroundColor: colors.background,
      paddingTop: 52,
      paddingBottom: 28,
      paddingHorizontal: 20,
    },
    panelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 4,
    },
    panelTitle: {
      flex: 1,
      fontSize: 20,
      fontWeight: '800',
      color: colors.textHeader,
    },
    clearText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.brandPink,
    },
    panelScroll: {
      flex: 1,
    },
    panelScrollContent: {
      paddingBottom: 8,
    },
    // ----- sections --------------------------------------------------------
    section: {
      marginTop: 18,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: colors.textSupplementary,
      marginBottom: 10,
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    // ----- chips -----------------------------------------------------------
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
    },
    chipSelected: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textBody,
    },
    chipTextSelected: {
      color: colors.white,
      fontWeight: '700',
    },
    // ----- done ------------------------------------------------------------
    doneButton: {
      marginTop: 16,
      paddingVertical: 14,
      borderRadius: 999,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
    },
    doneText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
  });

export type MarketFilterBarStyles = ReturnType<typeof createMarketFilterBarStyles>;
