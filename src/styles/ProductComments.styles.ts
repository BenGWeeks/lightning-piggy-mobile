import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

/**
 * Styles for {@link ProductComments} — the comments tab body: a compose box
 * (or sign-in prompt, or edit state) and the list of top-level comment rows
 * ({@link ProductCommentItem}, incl. its Edit / Delete actions).
 */
export const createProductCommentsStyles = (colors: Palette) =>
  StyleSheet.create({
    form: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      gap: 10,
      marginBottom: 16,
    },
    input: {
      minHeight: 56,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      padding: 10,
      color: colors.textBody,
      textAlignVertical: 'top',
      fontSize: 14,
    },
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
    itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    when: { fontSize: 12, color: colors.textSupplementary },
    editingBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    editingText: { fontSize: 13, fontWeight: '700', color: colors.textHeader },
    editingCancel: { fontSize: 13, fontWeight: '700', color: colors.brandPink },
    itemText: { fontSize: 14, color: colors.textBody, lineHeight: 20 },
    state: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      paddingVertical: 20,
    },
    loading: { paddingVertical: 24 },
    showMore: { alignItems: 'center', paddingVertical: 12 },
    showMoreText: { color: colors.brandPink, fontWeight: '700', fontSize: 14 },
  });

export type ProductCommentsStyles = ReturnType<typeof createProductCommentsStyles>;
