import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createInvitationKeysScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    list: { flex: 1 },
    content: { paddingBottom: 32 },
    header: { gap: 10, marginBottom: 16 },
    intro: { color: colors.white, fontSize: 14, lineHeight: 20 },
    note: { color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 19 },
    card: {
      backgroundColor: 'rgba(255,255,255,0.12)',
      padding: 16,
      borderRadius: 12,
      marginBottom: 12,
      gap: 6,
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    title: { color: colors.white, fontSize: 16, fontWeight: '700', flexShrink: 1 },
    badge: {
      backgroundColor: 'rgba(255,255,255,0.2)',
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    badgeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
    age: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
    detailsToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      paddingVertical: 4,
    },
    detailsToggleText: { color: colors.white, fontSize: 13, fontWeight: '600' },
    details: { gap: 4, paddingTop: 2 },
    detail: { color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 18 },
    button: {
      backgroundColor: colors.white,
      borderRadius: 10,
      padding: 13,
      alignItems: 'center',
      marginTop: 6,
    },
    buttonText: { color: colors.brandPink, fontWeight: '700', fontSize: 14 },
    link: { alignSelf: 'flex-start', paddingVertical: 4 },
    linkText: { color: colors.white, fontSize: 13, fontWeight: '600' },
    disabled: { opacity: 0.45 },
  });

export type InvitationKeysStyles = ReturnType<typeof createInvitationKeysScreenStyles>;
