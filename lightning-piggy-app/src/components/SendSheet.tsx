import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Animated,
  PanResponder,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { satsToFiatString } from '../services/fiatService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const SWIPE_THRESHOLD = 100;

const SendSheet: React.FC<Props> = ({ visible, onClose }) => {
  const { payInvoice, refreshBalance, balance, btcPrice, currency } = useWallet();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [scanned, setScanned] = useState(false);
  const dragY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 10,
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) dragY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > SWIPE_THRESHOLD) {
          onClose();
          dragY.setValue(0);
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      dragY.setValue(0);
      setScannedData(null);
      setScanned(false);
      setSending(false);
    }
  }, [visible]);

  const isValidInvoice = (data: string): boolean => {
    const lower = data.toLowerCase();
    return lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('ln');
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    // Strip lightning: prefix if present
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

  if (!permission) {
    return null;
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: dragY }] }]}
          {...panResponder.panHandlers}
        >
          <View style={styles.handle} />
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
                barcodeScannerSettings={{
                  barcodeTypes: ['qr'],
                }}
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

          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    alignItems: 'center',
    gap: 16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textHeader,
  },
  balanceText: {
    fontSize: 13,
    color: colors.textSupplementary,
    fontWeight: '600',
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
  closeButton: {
    paddingVertical: 12,
  },
  closeButtonText: {
    color: colors.textSupplementary,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default SendSheet;
