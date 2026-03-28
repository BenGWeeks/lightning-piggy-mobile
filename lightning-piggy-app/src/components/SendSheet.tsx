import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { satsToFiatString } from '../services/fiatService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SendSheet: React.FC<Props> = ({ visible, onClose }) => {
  const { payInvoice, refreshBalance, balance, btcPrice, currency } = useWallet();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [scanned, setScanned] = useState(false);
  const bottomSheetRef = useRef<BottomSheet>(null);

  const snapPoints = useMemo(() => ['85%'], []);

  useEffect(() => {
    if (visible) {
      setScannedData(null);
      setScanned(false);
      setSending(false);
      bottomSheetRef.current?.expand();
    } else {
      bottomSheetRef.current?.close();
    }
  }, [visible]);

  // Handle Android back button
  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [visible, onClose]);

  const isValidInvoice = (data: string): boolean => {
    const lower = data.toLowerCase();
    return lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('ln');
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    let invoice = data;
    if (invoice.toLowerCase().startsWith('lightning:')) {
      invoice = invoice.substring(10);
    }
    if (isValidInvoice(invoice)) {
      setScanned(true);
      setScannedData(invoice);
    }
  };

  const handleSend = async () => {
    if (!scannedData) return;
    setSending(true);
    try {
      await payInvoice(scannedData);
      await refreshBalance();
      Alert.alert('Payment Sent', 'Your payment was sent successfully!', [
        { text: 'OK', onPress: onClose },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payment failed';
      Alert.alert('Payment Failed', message);
    } finally {
      setSending(false);
    }
  };

  const handleCancel = () => {
    setScannedData(null);
    setScanned(false);
    onClose();
  };

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) onClose();
  }, [onClose]);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
    []
  );

  if (!visible || !permission) return null;

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      onChange={handleSheetChange}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>Send</Text>

        <View style={styles.cameraContainer}>
          {!permission.granted ? (
            <View style={styles.permissionContainer}>
              <Text style={styles.permissionText}>Camera access is needed to scan QR codes</Text>
              <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                <Text style={styles.permissionButtonText}>Grant Permission</Text>
              </TouchableOpacity>
            </View>
          ) : visible && !scannedData ? (
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleBarCodeScanned}
            />
          ) : scannedData ? (
            <View style={styles.scannedContainer}>
              <Text style={styles.scannedLabel}>Invoice detected</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.label}>Lightning invoice</Text>
        <Text style={styles.invoiceText} numberOfLines={4}>
          {scannedData || 'Scan a QR code to detect an invoice'}
        </Text>

        {balance !== null && btcPrice !== null && (
          <Text style={styles.balanceText}>
            Balance: {balance.toLocaleString()} sats ({satsToFiatString(balance, btcPrice, currency)})
          </Text>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sendButton, (!scannedData || sending) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!scannedData || sending}
          >
            {sending ? (
              <ActivityIndicator color={colors.brandPink} />
            ) : (
              <Text style={styles.sendButtonText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleIndicator: {
    backgroundColor: colors.divider,
    width: 40,
  },
  content: {
    padding: 20,
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textHeader,
  },
  cameraContainer: {
    width: 220,
    height: 220,
    borderRadius: 24,
    backgroundColor: colors.white,
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
  scannedContainer: {
    padding: 20,
    alignItems: 'center',
  },
  scannedLabel: {
    color: colors.green,
    fontSize: 16,
    fontWeight: '700',
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textHeader,
  },
  invoiceText: {
    color: colors.textSupplementary,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  balanceText: {
    fontSize: 13,
    color: colors.textSupplementary,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 20,
  },
  cancelButton: {
    backgroundColor: colors.white,
    height: 52,
    paddingHorizontal: 30,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  cancelButtonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
  sendButton: {
    backgroundColor: colors.white,
    height: 52,
    paddingHorizontal: 30,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
});

export default SendSheet;
