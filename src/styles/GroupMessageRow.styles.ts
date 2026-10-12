import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createGroupMessageRowStyles = (colors: Palette) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
    gutter: { width: 30, paddingTop: 4 },
    avatar: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initials: { color: colors.white, fontSize: 11, fontWeight: '700' },
    body: { flex: 1, minWidth: 0 },
    name: { color: colors.textBody, fontSize: 11, fontWeight: '700', marginTop: 4 },
  });
// Dark backgrounds keep white initials readable; deterministic per sender.
export const senderAvatarColors = ['#803369', '#563D90', '#216579', '#805122'];
