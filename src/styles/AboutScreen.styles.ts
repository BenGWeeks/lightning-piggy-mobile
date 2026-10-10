import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createAboutScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    teamCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    teamBanner: {
      width: '100%',
      height: 80,
    },
    teamRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      gap: 12,
    },
    teamPicture: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 2,
      borderColor: colors.divider,
    },
    teamPicturePlaceholder: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    teamInfo: {
      flex: 1,
    },
    teamName: {
      color: colors.textHeader,
      fontSize: 16,
      fontWeight: '700',
    },
    teamAbout: {
      color: colors.textSupplementary,
      fontSize: 12,
      marginTop: 2,
    },
    teamButtonRow: {
      paddingHorizontal: 16,
      paddingBottom: 16,
      gap: 8,
    },
    zapButton: {
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
      justifyContent: 'center',
      alignItems: 'center',
    },
    zapButtonText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '600',
    },
    feedbackButton: {
      height: 44,
      borderRadius: 10,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      // Secondary action — purple accent so it reads as the lighter-weight
      // sibling of the filled pink "Zap the Team" primary CTA above it.
      borderColor: colors.accentSecondary,
    },
    feedbackButtonText: {
      color: colors.accentSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    teamFallbackText: {
      color: colors.textSupplementary,
      fontSize: 14,
      padding: 20,
      textAlign: 'center',
    },
    aboutTitle: {
      color: colors.white,
      fontSize: 20,
      fontWeight: '700',
    },
    aboutBody: {
      color: colors.white,
      fontSize: 14,
      opacity: 0.9,
      lineHeight: 20,
    },
    websiteLink: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '600',
      textDecorationLine: 'underline',
      marginTop: 12,
    },
    versionText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '600',
      textAlign: 'center',
      paddingTop: 32,
    },
    profilerRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 12,
    },
    profilerButton: {
      flex: 1,
      backgroundColor: 'rgba(255,255,255,0.15)',
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profilerButtonPrimary: {
      backgroundColor: colors.brandPink,
    },
    profilerButtonDisabled: {
      opacity: 0.45,
    },
    profilerButtonText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '600',
    },
    profilerButtonTextPrimary: {
      color: colors.white,
    },
  });
