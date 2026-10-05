import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createProfileScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    profileSection: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    banner: {
      width: '100%',
      height: 100,
    },
    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      gap: 12,
    },
    profilePicture: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: 2,
      borderColor: colors.divider,
    },
    profilePicturePlaceholder: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileInfo: {
      flex: 1,
    },
    profileName: {
      color: colors.textHeader,
      fontSize: 18,
      fontWeight: '700',
    },
    profileNip05: {
      color: colors.textSupplementary,
      fontSize: 13,
      marginTop: 2,
    },
    profileAbout: {
      color: colors.textBody,
      fontSize: 14,
      paddingHorizontal: 16,
      paddingBottom: 12,
      lineHeight: 20,
    },
    editProfileButton: {
      margin: 16,
      marginBottom: 16,
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      // Secondary action — purple accent (matches the outlined secondary
      // buttons across Settings) so it sits below the primary brand pink.
      borderColor: colors.accentSecondary,
    },
    editProfileButtonText: {
      color: colors.accentSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    connectButton: {
      backgroundColor: 'rgba(255,255,255,0.2)',
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.4)',
    },
    connectButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
  });
