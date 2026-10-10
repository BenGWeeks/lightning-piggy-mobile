import { Platform, StyleSheet } from 'react-native';

import type { Palette } from './palettes';

export const createKeyBackupScreenStyles = (colors: Palette) =>
  StyleSheet.create({
    accountName: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '600',
      marginBottom: 16,
    },
    paragraph: {
      color: colors.white,
      fontSize: 15,
      lineHeight: 22,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      marginTop: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.surface,
    },
    statusText: {
      fontSize: 13,
      fontWeight: '700',
    },
    keyBox: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 20,
      paddingLeft: 16,
      paddingRight: 4,
      paddingVertical: 8,
      minHeight: 64,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    keyText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      color: colors.textBody,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    keyTextMasked: {
      letterSpacing: 2,
      color: colors.textSupplementary,
    },
    eyeButton: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hint: {
      color: 'rgba(255,255,255,0.75)',
      fontSize: 13,
      marginTop: 8,
    },
    errorText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '700',
      marginTop: 8,
    },
    buttonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    secondaryButton: {
      height: 52,
      borderRadius: 12,
      marginTop: 16,
      borderWidth: 2,
      borderColor: colors.white,
      justifyContent: 'center',
      alignItems: 'center',
    },
    secondaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    signerCard: {
      flexDirection: 'row',
      gap: 12,
      alignItems: 'flex-start',
    },
    signerCardText: {
      flex: 1,
      gap: 8,
    },
    signerTitle: {
      color: colors.white,
      fontSize: 17,
      fontWeight: '700',
    },
  });

export type KeyBackupScreenStyles = ReturnType<typeof createKeyBackupScreenStyles>;
