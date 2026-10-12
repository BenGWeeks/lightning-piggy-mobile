import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createMuteNotificationsStyles = (colors: Palette) =>
  StyleSheet.create({
    button: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
    text: { color: colors.textBody, flexShrink: 1 },
    heading: { color: colors.textHeader, fontWeight: '600', padding: 12 },
    list: { flex: 1 },
    row: { paddingHorizontal: 12 },
    identity: { color: colors.textBody },
  });
