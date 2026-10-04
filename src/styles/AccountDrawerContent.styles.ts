import { StyleSheet, Platform } from 'react-native';
import type { Palette } from './palettes';

export const createAccountDrawerContentStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    scrollContent: {
      paddingTop: 0,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 20,
      alignItems: 'flex-start',
    },
    headerAvatarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'stretch',
      marginBottom: 12,
    },
    avatarLarge: {
      width: 48,
      height: 48,
      borderRadius: 24,
      overflow: 'hidden',
      backgroundColor: 'rgba(0,0,0,0.05)',
    },
    avatarImage: {
      width: 48,
      height: 48,
      borderRadius: 24,
    },
    switcherAvatars: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      // Switcher avatars stack flush-right adjacent to the ⋯ button —
      // active avatar stays on the left and gets visual breathing room.
      // marginLeft: 'auto' pushes this group to fill the space between
      // the large avatar and the menu trigger.
      marginLeft: 'auto',
      marginRight: 8,
    },
    avatarSmall: {
      width: 28,
      height: 28,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: 'rgba(0,0,0,0.05)',
    },
    avatarSmallImage: {
      width: 28,
      height: 28,
      borderRadius: 14,
    },
    moreButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
      // marginLeft: 'auto' here is a single-identity safety net. When
      // `switcherAvatars` renders, its own `marginLeft: 'auto'` fires
      // FIRST (consumes the available row space) and this one is a
      // no-op — both elements end up flush-right adjacent to each
      // other, as the original design intended. When `switcherAvatars`
      // does NOT render (no other identities signed in), this auto-
      // margin keeps the ⋯ button right-aligned. Without it, the
      // button collapsed left next to the avatar (#492).
      marginLeft: 'auto',
    },
    avatarPlaceholder: {
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerName: {
      color: colors.textHeader,
      fontSize: 18,
      fontWeight: '700',
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'stretch',
    },
    flex1: {
      flex: 1,
    },
    signInButton: {
      alignSelf: 'stretch',
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 4,
    },
    signInButtonText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
    headerNpub: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 2,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginVertical: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    rowDisabled: {
      opacity: 0.4,
    },
    rowIcon: {
      width: 24,
      alignItems: 'center',
    },
    rowLabel: {
      color: colors.textBody,
      fontSize: 16,
      fontWeight: '600',
    },
    footer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      paddingTop: 12,
      paddingHorizontal: 20,
      alignItems: 'center',
    },
    versionText: {
      color: colors.textSupplementary,
      fontSize: 12,
    },
  });
