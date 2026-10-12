import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createMuteNotificationsStyles = (colors: Palette) =>
  StyleSheet.create({
    button: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
    text: { color: colors.textBody, flexShrink: 1 },
    heading: { color: colors.textHeader, fontWeight: '700', fontSize: 18 },
    list: { flex: 1 },
    cardSegment: { borderWidth: 0, borderRadius: 0 },
    cardHeader: { marginTop: 24, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
    cardFooter: {
      borderBottomLeftRadius: 10,
      borderBottomRightRadius: 10,
      paddingVertical: 4,
    },
    row: { gap: 12 },
    identity: { color: colors.textBody, fontSize: 15, fontWeight: '600', flex: 1 },
    avatar: { width: 40, height: 40, borderRadius: 20 },
    avatarFallback: {
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    unmuteButton: {
      backgroundColor: colors.brandPink,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
      maxWidth: '45%',
    },
    unmuteText: { color: colors.white, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  });
