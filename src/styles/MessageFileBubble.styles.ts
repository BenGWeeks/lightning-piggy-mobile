import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createMessageFileBubbleStyles = (colors: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', paddingHorizontal: 12, marginVertical: 4 },
    sent: { justifyContent: 'flex-end' },
    bubble: { maxWidth: '85%', padding: 12, borderRadius: 16, backgroundColor: colors.surface },
    name: { color: colors.textBody, fontWeight: '600', marginTop: 6 },
    caption: { color: colors.textSupplementary, fontSize: 12, marginTop: 4 },
    action: { paddingVertical: 10 },
    actionText: { color: colors.brandPink, fontWeight: '600' },
  });
