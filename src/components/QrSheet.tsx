import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BackHandler } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { Copy } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  visible: boolean;
  onClose: () => void;
  npub: string;
  lightningAddress?: string | null;
  defaultMode?: 'npub' | 'lightning';
}

type QrMode = 'npub' | 'lightning';

const QrSheet: React.FC<Props> = ({
  visible,
  onClose,
  npub,
  lightningAddress,
  defaultMode = 'npub',
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [mode, setMode] = useState<QrMode>(defaultMode);
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['55%'], []);

  useEffect(() => {
    if (visible) {
      setMode(defaultMode);
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const qrValue = mode === 'npub' ? npub : lightningAddress || '';
  const label = mode === 'npub' ? 'Nostr Public Key' : 'Lightning Address';
  const displayValue =
    mode === 'npub' ? `${npub.slice(0, 16)}...${npub.slice(-8)}` : lightningAddress || '';

  const handleCopy = async () => {
    await Clipboard.setStringAsync(qrValue);
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>{label}</Text>

        {/* Toggle */}
        {lightningAddress && (
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleTab, mode === 'npub' && styles.toggleTabActive]}
              onPress={() => setMode('npub')}
            >
              <Text style={[styles.toggleText, mode === 'npub' && styles.toggleTextActive]}>
                npub
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleTab, mode === 'lightning' && styles.toggleTabActive]}
              onPress={() => setMode('lightning')}
            >
              <Text style={[styles.toggleText, mode === 'lightning' && styles.toggleTextActive]}>
                Lightning
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* QR Code — always black-on-white for maximum scan reliability,
            regardless of light/dark theme. Themed colors (colors.textHeader
            on colors.white) make the QR render light-grey-on-white in dark
            mode, which scanners struggle with. The QR is visually wrapped
            in styles.qrContainer (a white card with padding) so the white
            BG plays nicely with both themes. */}
        <View style={styles.qrContainer}>
          <QRCode value={qrValue} size={200} backgroundColor="#FFFFFF" color="#000000" />
        </View>

        {/* Value + copy */}
        <TouchableOpacity style={styles.valueRow} onPress={handleCopy}>
          <Text style={styles.valueText} numberOfLines={1}>
            {displayValue}
          </Text>
          <Copy size={22} color={colors.brandPink} />
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
      width: 40,
    },
    content: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 40,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 16,
    },
    toggleRow: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderRadius: 10,
      padding: 3,
      marginBottom: 20,
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
      marginBottom: 16,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
    },
    valueText: {
      fontSize: 13,
      color: colors.textSupplementary,
      fontWeight: '500',
      flex: 1,
    },
  });

export default QrSheet;
