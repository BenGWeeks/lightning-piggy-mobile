import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
import { ATTACHMENT_WIDTH } from './attachmentGeometry';

export const createMessageFileBubbleStyles = (colors: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', marginVertical: 2 },
    sent: { justifyContent: 'flex-end' },
    bubble: {
      width: ATTACHMENT_WIDTH,
      maxWidth: '85%',
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    body: { padding: 12 },
    preview: {
      width: '100%',
      aspectRatio: 1 / Math.SQRT2,
      backgroundColor: '#fff',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    name: { color: colors.textBody, fontWeight: '600', marginTop: 6 },
    caption: { color: colors.textSupplementary, fontSize: 12, marginTop: 4 },
    action: { paddingVertical: 10 },
    actionText: { color: colors.brandPink, fontWeight: '600' },
  });
