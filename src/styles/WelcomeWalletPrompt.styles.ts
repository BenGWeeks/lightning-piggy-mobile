import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createWelcomeWalletPromptStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      padding: 24,
      gap: 16,
      alignItems: 'center',
    },
    iconBubble: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 15,
      color: colors.textBody,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 12,
    },
    primaryButton: {
      alignSelf: 'stretch',
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
  });
