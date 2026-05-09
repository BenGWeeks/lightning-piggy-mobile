import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import Toast from './BrandedToast';
import { Copy, Share2 } from 'lucide-react-native';
import NfcIcon from './icons/NfcIcon';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  npub: string;
  lightningAddress?: string | null;
  defaultMode?: 'npub' | 'lightning';
  // When true, the NFC button renders. Caller passes the result of
  // `isNfcSupported()` so we don't duplicate that probe per call site.
  nfcSupported?: boolean;
  onNfcWrite?: () => void;
}

type QrMode = 'npub' | 'lightning';

const QrWithIdentityToggle: React.FC<Props> = ({
  npub,
  lightningAddress,
  defaultMode = 'npub',
  nfcSupported = false,
  onNfcWrite,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mode, setMode] = useState<QrMode>(defaultMode);

  const qrValue = mode === 'npub' ? npub : lightningAddress || '';
  const displayValue =
    mode === 'npub' ? `${npub.slice(0, 16)}...${npub.slice(-8)}` : lightningAddress || '';
  const valueLabel = mode === 'npub' ? 'npub' : 'Lightning address';

  const handleCopy = async () => {
    await Clipboard.setStringAsync(qrValue);
    Toast.show({
      type: 'success',
      text1: `${valueLabel} copied`,
      position: 'top',
      visibilityTime: 1800,
    });
  };

  const handleShare = async () => {
    try {
      await Share.share({ message: qrValue });
    } catch {
      // User dismissed the share sheet — no-op.
    }
  };

  return (
    <View style={styles.container}>
      {lightningAddress && (
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleTab, mode === 'npub' && styles.toggleTabActive]}
            onPress={() => setMode('npub')}
            accessibilityLabel="Show npub QR"
            testID="profile-qr-toggle-npub"
          >
            <Text style={[styles.toggleText, mode === 'npub' && styles.toggleTextActive]}>
              npub
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleTab, mode === 'lightning' && styles.toggleTabActive]}
            onPress={() => setMode('lightning')}
            accessibilityLabel="Show Lightning address QR"
            testID="profile-qr-toggle-lightning"
          >
            <Text style={[styles.toggleText, mode === 'lightning' && styles.toggleTextActive]}>
              Lightning
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.qrContainer} testID="profile-qr-image">
        <QRCode value={qrValue} size={200} backgroundColor="#FFFFFF" color="#000000" />
      </View>

      <TouchableOpacity style={styles.valueRow} onPress={handleCopy}>
        <Text style={styles.valueText} numberOfLines={1}>
          {displayValue}
        </Text>
        <Copy size={20} color={colors.brandPink} />
      </TouchableOpacity>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={handleCopy}
          accessibilityLabel={`Copy ${valueLabel}`}
          testID="profile-qr-copy-button"
        >
          <Copy size={22} color={colors.brandPink} />
        </TouchableOpacity>

        {onNfcWrite && (
          <TouchableOpacity
            style={[styles.iconButton, !nfcSupported && styles.iconButtonDisabled]}
            onPress={nfcSupported ? onNfcWrite : undefined}
            disabled={!nfcSupported}
            accessibilityLabel={
              nfcSupported ? `Write ${valueLabel} to NFC tag` : 'NFC not supported on this device'
            }
            testID="profile-qr-nfc-button"
          >
            <NfcIcon size={22} color={nfcSupported ? colors.brandPink : colors.textSupplementary} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.iconButton}
          onPress={handleShare}
          accessibilityLabel={`Share ${valueLabel}`}
          testID="profile-qr-share-button"
        >
          <Share2 size={22} color={colors.brandPink} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      marginHorizontal: 16,
      marginTop: 18,
      marginBottom: 12,
      paddingHorizontal: 16,
      paddingTop: 28,
      paddingBottom: 16,
      gap: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.brandPink,
    },
    // Toggle styling matches the original bottom-sheet QrSheet for
    // theme-consistent contrast: track uses `colors.background` (the
    // page bg, darker than `colors.surface` which is what the box
    // uses), active tab is white with brandPink text. Works in both
    // light and dark themes — the page bg and surface bg are the two
    // standard contrasting tones in the palette.
    toggleRow: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderRadius: 10,
      padding: 3,
      marginTop: -46,
    },
    toggleTab: {
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 8,
    },
    toggleTabActive: {
      backgroundColor: colors.white,
    },
    toggleText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    toggleTextActive: {
      color: colors.brandPink,
    },
    qrContainer: {
      padding: 16,
      backgroundColor: colors.white,
      borderRadius: 16,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
      maxWidth: '90%',
    },
    valueText: {
      fontSize: 13,
      color: colors.textSupplementary,
      fontWeight: '500',
      flex: 1,
    },
    actionRow: {
      flexDirection: 'row',
      gap: 16,
      paddingTop: 4,
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    iconButtonDisabled: {
      opacity: 0.4,
    },
  });

export default QrWithIdentityToggle;
