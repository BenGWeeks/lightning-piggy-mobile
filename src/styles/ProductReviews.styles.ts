import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Styles for {@link ProductReviews} — the reviews tab body: aggregate stars,
 * the compose form (or sign-in prompt) and the list of review rows.
 */
export const createProductReviewsStyles = (colors: Palette) =>
  StyleSheet.create({
    aggregate: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 14,
    },
    aggregateAvg: { fontSize: 16, fontWeight: '800', color: colors.textHeader },
    aggregateCount: { fontSize: 13, color: colors.textSupplementary },
    form: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      gap: 10,
      marginBottom: 16,
    },
    formLabel: { fontSize: 14, fontWeight: '700', color: colors.textHeader },
    input: {
      minHeight: 64,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      padding: 10,
      color: colors.textBody,
      textAlignVertical: 'top',
      fontSize: 14,
    },
    hint: { fontSize: 12, color: colors.red },
    submit: {
      backgroundColor: colors.brandPink,
      borderRadius: 999,
      paddingVertical: 10,
      alignItems: 'center',
    },
    submitDisabled: { opacity: 0.6 },
    submitText: { color: colors.white, fontWeight: '800', fontSize: 14 },
    signInCard: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.divider,
      borderRadius: 12,
      paddingVertical: 18,
      alignItems: 'center',
      marginBottom: 16,
    },
    signInText: { color: colors.brandPink, fontWeight: '700', fontSize: 14 },
    item: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      gap: 6,
      marginBottom: 10,
    },
    itemHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    when: { fontSize: 12, color: colors.textSupplementary },
    itemText: { fontSize: 14, color: colors.textBody, lineHeight: 20 },
    state: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      paddingVertical: 20,
    },
    loading: { paddingVertical: 24 },
  });

export type ProductReviewsStyles = ReturnType<typeof createProductReviewsStyles>;
