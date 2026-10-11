import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Styles for {@link FeedbackActions} — the "⋯" button and the inline
 * Edit / Delete chips on your own Market comments and reviews.
 */
export const createFeedbackActionsStyles = (colors: Palette) =>
  StyleSheet.create({
    button: { paddingHorizontal: 4, paddingVertical: 2 },
    row: { flexDirection: 'row', gap: 10, paddingTop: 4 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    chipText: { fontSize: 13, fontWeight: '700', color: colors.brandPink },
    chipDanger: { color: colors.red },
  });
