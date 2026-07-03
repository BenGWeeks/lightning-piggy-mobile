import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Share } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import Toast from './BrandedToast';
import { Copy, Share2, Nfc } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
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
  const t = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Clamp the initial mode to 'npub' when no lightning address exists —
  // otherwise a defaultMode='lightning' caller produces an empty
  // qrValue and a misleading "Lightning address copied" Toast.
  const initialMode: QrMode = !lightningAddress ? 'npub' : defaultMode;
  const [mode, setMode] = useState<QrMode>(initialMode);

  // The plain identity string (used for the truncated display row)
  // and the URI-prefixed value used by the QR + Share + Copy paths.
  // Per NIP-21 the QR / Share encodes `nostr:<npub…>` for the Nostr
  // identity and `lightning:<lud16>` for the Lightning address so
  // scans / shared text deep-link correctly into other Nostr / LN
  // wallets (Damus, Amethyst, Phoenix, etc.). The plain string is
  // still what we copy to the clipboard since most users expect to
  // paste a clean npub or address into a profile field.
  const plainValue = mode === 'npub' ? npub : lightningAddress || '';
  const qrValue = mode === 'npub' ? `nostr:${npub}` : `lightning:${lightningAddress || ''}`;
  const displayValue =
    mode === 'npub' ? `${npub.slice(0, 16)}...${npub.slice(-8)}` : lightningAddress || '';
  const valueLabel = mode === 'npub' ? 'npub' : t('qrWithIdentityToggle.lightningAddress');

  const handleCopy = async () => {
    await Clipboard.setStringAsync(plainValue);
    Toast.show({
      type: 'success',
      text1: t('qrWithIdentityToggle.copied', { label: valueLabel }),
      position: 'top',
      visibilityTime: 1800,
    });
  };

  const handleShare = async () => {
    try {
      // Share the URI-prefixed form so the receiving app can deep-link.
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
            accessibilityLabel={t('qrWithIdentityToggle.showNpubQr')}
            testID="profile-qr-toggle-npub"
          >
            <Text style={[styles.toggleText, mode === 'npub' && styles.toggleTextActive]}>
              npub
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleTab, mode === 'lightning' && styles.toggleTabActive]}
            onPress={() => setMode('lightning')}
            accessibilityLabel={t('qrWithIdentityToggle.showLightningQr')}
            testID="profile-qr-toggle-lightning"
          >
            <Text style={[styles.toggleText, mode === 'lightning' && styles.toggleTextActive]}>
              Lightning
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <View
        style={styles.qrContainer}
        testID="profile-qr-image"
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('qrWithIdentityToggle.qrCodeFor', { label: valueLabel })}
      >
        <QRCode value={qrValue} size={200} backgroundColor="#FFFFFF" color="#000000" />
      </View>

      <TouchableOpacity
        style={styles.valueRow}
        onPress={handleCopy}
        accessibilityRole="button"
        accessibilityLabel={t('qrWithIdentityToggle.copy', { label: valueLabel })}
        testID="profile-qr-value-row"
      >
        <Text style={styles.valueText} numberOfLines={1}>
          {displayValue}
        </Text>
        <Copy size={20} color={colors.brandPink} />
      </TouchableOpacity>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={handleCopy}
          accessibilityLabel={t('qrWithIdentityToggle.copy', { label: valueLabel })}
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
              nfcSupported
                ? t('qrWithIdentityToggle.writeToNfc', { label: valueLabel })
                : t('qrWithIdentityToggle.nfcNotSupported')
            }
            testID="profile-qr-nfc-button"
          >
            <Nfc
              size={22}
              color={nfcSupported ? colors.brandPink : colors.textSupplementary}
              strokeWidth={2}
            />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.iconButton}
          onPress={handleShare}
          accessibilityLabel={t('qrWithIdentityToggle.share', { label: valueLabel })}
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
