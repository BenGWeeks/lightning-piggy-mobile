import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
export const createInvitationKeysScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    list: { flex: 1 },
    content: { paddingBottom: 32 },
    card: {
      backgroundColor: 'rgba(255,255,255,0.12)',
      padding: 16,
      borderRadius: 12,
      marginBottom: 12,
      gap: 8,
    },
    title: { color: colors.white, fontSize: 16, fontWeight: '700' },
    text: { color: colors.white, fontSize: 14, lineHeight: 20 },
    detail: { color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 18 },
    slot: { color: colors.white, fontSize: 12, fontWeight: '600', marginVertical: 10 },
    button: {
      backgroundColor: colors.white,
      borderRadius: 10,
      padding: 13,
      alignItems: 'center',
      marginVertical: 5,
    },
    buttonText: { color: colors.brandPink, fontWeight: '700', fontSize: 14 },
    disabled: { opacity: 0.45 },
    header: { gap: 8, marginBottom: 16 },
  });
export type InvitationKeysStyles = ReturnType<typeof createInvitationKeysScreenStyles>;
