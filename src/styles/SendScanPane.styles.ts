import { StyleSheet } from 'react-native';
import type { Palette } from './palettes';

export const createSendScanPaneStyles = (colors: Palette) =>
  StyleSheet.create({
    cameraContainer: {
      width: 240,
      height: 240,
      borderRadius: 24,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.background,
    },
    camera: {
      width: '100%',
      height: '100%',
    },
    permissionContainer: {
      padding: 20,
      alignItems: 'center',
      gap: 12,
    },
    permissionText: {
      color: colors.textBody,
      fontSize: 14,
      textAlign: 'center',
    },
    permissionButton: {
      backgroundColor: colors.brandPink,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 8,
    },
    permissionButtonText: {
      color: colors.white,
      fontWeight: '700',
    },
  });
