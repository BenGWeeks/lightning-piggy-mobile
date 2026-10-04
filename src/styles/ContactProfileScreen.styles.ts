import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createContactProfileScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    topBar: {
      position: 'absolute',
      left: 8,
      right: 8,
      zIndex: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    headerButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.6)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrollContent: {
      paddingBottom: 48,
    },
    bannerContainer: {
      width: '100%',
      height: 200,
      overflow: 'hidden',
      backgroundColor: colors.brandPinkLight,
    },
    bannerImage: {
      width: '100%',
      height: '100%',
    },
    identityRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      paddingHorizontal: 16,
      marginTop: -48,
      gap: 12,
    },
    identityActionsBlock: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 6,
      flexWrap: 'wrap',
      gap: 8,
    },
    avatarContainer: {
      borderRadius: 51,
      borderWidth: 3,
      borderColor: colors.surface,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    avatar: {
      width: 96,
      height: 96,
      borderRadius: 48,
    },
    avatarDefault: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    name: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 12,
      paddingHorizontal: 16,
    },
    nip05: {
      fontSize: 13,
      color: colors.brandPink,
      marginTop: 2,
      paddingHorizontal: 16,
    },
    npubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
      paddingHorizontal: 16,
    },
    npubText: {
      fontSize: 12,
      color: colors.textSupplementary,
      fontWeight: '500',
    },
    lightningAddress: {
      fontSize: 13,
      color: colors.textSupplementary,
    },
    lnAddressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
      paddingHorizontal: 16,
    },
    lnAddressEditRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
      paddingHorizontal: 16,
    },
    lnAddressInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.brandPinkLight,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 14,
      color: colors.textHeader,
    },
    lnAddressSaveButton: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: colors.brandPink,
    },
    lnAddressSaveText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.white,
    },
    actionIconGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    actionIconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionIconButtonDisabled: {
      backgroundColor: colors.textSupplementary,
      opacity: 0.5,
    },
    followButton: {
      paddingHorizontal: 22,
      paddingVertical: 10,
      borderRadius: 22,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 110,
    },
    followingButton: {
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderColor: colors.brandPink,
      // Subtract the border width so following / not-following pills
      // visually align at the same height.
      paddingVertical: 8.5,
    },
    followButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.white,
    },
    followingButtonText: {
      color: colors.brandPink,
    },
    aboutContainer: {
      paddingHorizontal: 16,
      marginTop: 16,
    },
    aboutText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textBody,
    },
  });
