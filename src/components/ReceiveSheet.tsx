import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Share,
  TextInput,
  ActivityIndicator,
  BackHandler,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import QRCode from 'react-native-qrcode-svg';
import CopyIcon from './icons/CopyIcon';
import ShareIcon from './icons/ShareIcon';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { satsToFiatString, satsToFiat } from '../services/fiatService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Mode = 'address' | 'amount';
type InputUnit = 'sats' | 'fiat';

const ReceiveSheet: React.FC<Props> = ({ visible, onClose }) => {
  const { makeInvoice, refreshBalance, balance, btcPrice, currency, lightningAddress } = useWallet();
  const [mode, setMode] = useState<Mode>('address');
  const [invoice, setInvoice] = useState('');
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [satsValue, setSatsValue] = useState('');
  const [fiatValue, setFiatValue] = useState('');
  const [inputUnit, setInputUnit] = useState<InputUnit>('sats');
  const intervalId = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevBalance = useRef<number | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomSheetRef = useRef<BottomSheet>(null);

  const snapPoints = useMemo(() => ['85%'], []);

  const fiatToSats = (fiat: number): number => {
    if (!btcPrice || btcPrice <= 0) return 0;
    return Math.round((fiat / btcPrice) * 100_000_000);
  };

  const generateInvoice = useCallback(async (sats: number) => {
    if (intervalId.current) {
      clearInterval(intervalId.current);
      intervalId.current = null;
    }
    setLoading(true);
    setPaymentReceived(false);
    try {
      const inv = await makeInvoice(sats, 'Lightning Piggy');
      setInvoice(inv);
      intervalId.current = setInterval(async () => {
        await refreshBalance();
      }, 5000);
    } catch (error) {
      console.warn('Failed to create invoice:', error);
    } finally {
      setLoading(false);
    }
  }, [makeInvoice, refreshBalance]);

  // Open/close the sheet
  useEffect(() => {
    if (visible) {
      prevBalance.current = balance;
      setMode(lightningAddress ? 'address' : 'amount');
      setSatsValue('');
      setFiatValue('');
      setInvoice('');
      setPaymentReceived(false);
      setInputUnit('sats');
      bottomSheetRef.current?.expand();
    } else {
      bottomSheetRef.current?.close();
    }
    return () => {
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
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

  // Detect payment by watching balance changes
  useEffect(() => {
    if (visible && prevBalance.current !== null && balance !== null && balance > prevBalance.current) {
      setPaymentReceived(true);
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
    }
  }, [balance, visible]);

  const scheduleInvoice = (sats: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (sats <= 0) {
      setInvoice('');
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
      return;
    }
    debounceTimer.current = setTimeout(() => {
      if (sats > 0 && visible) generateInvoice(sats);
    }, 800);
  };

  const handleSatsChange = (text: string) => {
    setSatsValue(text);
    const sats = parseInt(text) || 0;
    if (btcPrice) {
      setFiatValue(satsToFiat(sats, btcPrice).toFixed(2));
    } else {
      setFiatValue('0.00');
    }
    scheduleInvoice(sats);
  };

  const handleFiatChange = (text: string) => {
    setFiatValue(text);
    const fiat = parseFloat(text) || 0;
    const sats = fiatToSats(fiat);
    setSatsValue(sats.toString());
    scheduleInvoice(sats);
  };

  const currentSats = parseInt(satsValue) || 0;
  const copyValue = mode === 'address' ? lightningAddress || '' : invoice;

  const handleCopy = async () => {
    if (copyValue) await Clipboard.setStringAsync(copyValue);
  };

  const handleShare = async () => {
    if (copyValue) {
      try {
        await Share.share({ message: mode === 'address' ? `lightning:${lightningAddress}` : `lightning:${invoice}` });
      } catch {}
    }
  };

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) onClose();
  }, [onClose]);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
    []
  );

  if (!visible) return null;

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
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.innerContent}>
        <Text style={styles.title}>Receive</Text>

        {/* Mode tabs */}
        {lightningAddress ? (
          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tab, mode === 'address' && styles.tabActive]}
              onPress={() => setMode('address')}
            >
              <Text style={[styles.tabText, mode === 'address' && styles.tabTextActive]}>
                Address
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, mode === 'amount' && styles.tabActive]}
              onPress={() => setMode('amount')}
            >
              <Text style={[styles.tabText, mode === 'amount' && styles.tabTextActive]}>
                Amount
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Amount input */}
        {mode === 'amount' ? (
          <View style={styles.amountSection}>
            <View style={styles.amountRow}>
              <TextInput
                style={styles.amountInput}
                value={inputUnit === 'sats' ? satsValue : fiatValue}
                onChangeText={inputUnit === 'sats' ? handleSatsChange : handleFiatChange}
                keyboardType={inputUnit === 'sats' ? 'numeric' : 'decimal-pad'}
                placeholder={inputUnit === 'sats' ? '0' : '0.00'}
              />
              <TouchableOpacity
                style={[styles.unitButton, inputUnit === 'sats' && styles.unitButtonActive]}
                onPress={() => setInputUnit('sats')}
              >
                <Text style={[styles.unitButtonText, inputUnit === 'sats' && styles.unitButtonTextActive]}>
                  Sats
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unitButton, inputUnit === 'fiat' && styles.unitButtonActive]}
                onPress={() => setInputUnit('fiat')}
              >
                <Text style={[styles.unitButtonText, inputUnit === 'fiat' && styles.unitButtonTextActive]}>
                  {currency}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.convertedAmount}>
              {inputUnit === 'sats'
                ? (btcPrice && currentSats > 0 ? satsToFiatString(currentSats, btcPrice, currency) : '')
                : (currentSats > 0 ? `${currentSats.toLocaleString()} sats` : '')
              }
            </Text>
          </View>
        ) : null}

        {/* QR Code */}
        <View style={styles.qrContainer}>
          {mode === 'address' && lightningAddress ? (
            <View>
              <QRCode value={`lightning:${lightningAddress}`} size={200} />
              {paymentReceived && (
                <View style={styles.checkmark}>
                  <Text style={styles.checkmarkText}>✓</Text>
                </View>
              )}
            </View>
          ) : mode === 'amount' && loading ? (
            <ActivityIndicator size="large" color={colors.brandPink} />
          ) : mode === 'amount' && invoice ? (
            <View>
              <QRCode value={invoice} size={200} />
              {paymentReceived && (
                <View style={styles.checkmark}>
                  <Text style={styles.checkmarkText}>✓</Text>
                </View>
              )}
            </View>
          ) : (
            <Text style={styles.noInvoice}>
              {mode === 'address' ? 'No lightning address set' : 'Enter an amount to generate invoice'}
            </Text>
          )}
        </View>

        <Text style={styles.qrLabel}>
          {mode === 'address' ? lightningAddress : 'Lightning invoice'}
        </Text>
        {mode === 'amount' && invoice ? (
          <Text style={styles.invoiceText} numberOfLines={2}>{invoice}</Text>
        ) : null}

        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.actionButton} onPress={handleCopy}>
            <CopyIcon color={colors.brandPink} />
            <Text style={styles.actionButtonText}>Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={handleShare}>
            <Text style={styles.actionButtonText}>Share</Text>
            <ShareIcon color={colors.brandPink} />
          </TouchableOpacity>
        </View>
        </View>
      </TouchableWithoutFeedback>
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
    flex: 1,
  },
  innerContent: {
    padding: 20,
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textHeader,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.divider,
    borderRadius: 10,
    padding: 3,
  },
  tab: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: colors.white,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSupplementary,
  },
  tabTextActive: {
    color: colors.brandPink,
  },
  amountSection: {
    alignItems: 'center',
    gap: 4,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  amountInput: {
    backgroundColor: colors.white,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: 100,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  unitButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.divider,
  },
  unitButtonActive: {
    backgroundColor: colors.brandPink,
  },
  unitButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textSupplementary,
  },
  unitButtonTextActive: {
    color: colors.white,
  },
  convertedAmount: {
    fontSize: 13,
    color: colors.textSupplementary,
    fontWeight: '500',
    minHeight: 18,
  },
  qrContainer: {
    width: 220,
    height: 220,
    borderRadius: 24,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.background,
  },
  checkmark: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.green,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    color: colors.white,
    fontSize: 28,
    fontWeight: '700',
  },
  noInvoice: {
    color: colors.textSupplementary,
    fontSize: 14,
    textAlign: 'center',
    padding: 20,
  },
  qrLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textBody,
  },
  invoiceText: {
    color: colors.textSupplementary,
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 20,
  },
  actionButton: {
    backgroundColor: colors.white,
    height: 52,
    paddingHorizontal: 30,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  actionButtonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
});

export default ReceiveSheet;
