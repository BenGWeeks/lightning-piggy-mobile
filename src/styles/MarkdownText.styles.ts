import { Platform, StyleSheet } from 'react-native';
import type { Palette } from './palettes';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Styles for {@link MarkdownText} — sized for a product page body, with
 * headings scaled down so a seller's "# Title" doesn't dwarf the card. */
export const createMarkdownTextStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { gap: 8 },
    paragraph: { fontSize: 15, lineHeight: 22, color: colors.textBody },
    h1: { fontSize: 18, lineHeight: 24, fontWeight: '700', color: colors.textHeader },
    h2: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: colors.textHeader },
    h3: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: colors.textHeader },
    bold: { fontWeight: '700' },
    italic: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through' },
    code: {
      fontFamily: MONO,
      fontSize: 13,
      backgroundColor: colors.divider,
      color: colors.textHeader,
    },
    link: { color: colors.brandPink, textDecorationLine: 'underline' },
    list: { gap: 4 },
    listItem: { flexDirection: 'row', gap: 8 },
    bullet: { fontSize: 15, lineHeight: 22, color: colors.textSupplementary, minWidth: 16 },
    listItemBody: { flex: 1, gap: 4 },
    quote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.brandPink,
      paddingLeft: 10,
      gap: 6,
    },
    codeBlock: {
      fontFamily: MONO,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textHeader,
      backgroundColor: colors.divider,
      borderRadius: 8,
      padding: 10,
    },
    more: { fontSize: 14, fontWeight: '700', color: colors.brandPink, paddingVertical: 4 },
  });

export type MarkdownTextStyles = ReturnType<typeof createMarkdownTextStyles>;
