import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';
import type { ProfileHeaderLayout } from '../utils/profileHeaderLayout';

/**
 * Profile page (ContactProfileScreen + ContactProfileHeader). The identity
 * row is sized by `profileHeaderLayout` (#1332): the avatar overlaps the
 * banner by half its height, and the action buttons + Follow pill sit on ONE
 * non-wrapping row, vertically centred in the strip below the banner.
 */
export const createContactProfileScreenStyles = (colors: Palette, layout: ProfileHeaderLayout) =>
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
    listContent: {
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
      marginTop: -layout.overlap,
      gap: 12,
    },
    // Exactly the strip below the banner, so centring the row in it lines the
    // buttons up with each other AND keeps them off the banner.
    identityActionsBlock: {
      flex: 1,
      height: layout.actionStripHeight,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexWrap: 'nowrap',
      gap: 8,
    },
    avatarContainer: {
      borderRadius: layout.avatarOuter / 2,
      borderWidth: 3,
      borderColor: colors.surface,
      overflow: 'hidden',
      backgroundColor: colors.background,
    },
    avatar: {
      width: layout.avatarSize,
      height: layout.avatarSize,
      borderRadius: layout.avatarSize / 2,
    },
    avatarDefault: {
      width: layout.avatarSize,
      height: layout.avatarSize,
      borderRadius: layout.avatarSize / 2,
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
      gap: layout.iconGap,
      flexShrink: 0,
    },
    actionIconButton: {
      width: layout.iconSize,
      height: layout.iconSize,
      borderRadius: layout.iconSize / 2,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionIconButtonDisabled: {
      backgroundColor: colors.textSupplementary,
      opacity: 0.5,
    },
    // Same height as the round buttons so the whole row shares one centre
    // line; shrinks (label ellipsised) rather than wrapping when space is short.
    followButton: {
      height: layout.iconSize,
      paddingHorizontal: layout.followPaddingH,
      borderRadius: layout.iconSize / 2,
      borderWidth: 1.5,
      borderColor: colors.brandPink,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: layout.followMinWidth,
      flexShrink: 1,
    },
    followingButton: {
      backgroundColor: 'transparent',
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
  });

export type ContactProfileScreenStyles = ReturnType<typeof createContactProfileScreenStyles>;
