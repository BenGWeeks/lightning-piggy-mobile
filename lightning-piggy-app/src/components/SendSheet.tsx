import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  BackHandler,
  TextInput,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { decode as bolt11Decode } from 'light-bolt11-decoder';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { satsToFiat, satsToFiatString } from '../services/fiatService';
import { resolveLightningAddress, fetchInvoice, LnurlPayParams } from '../services/lnurlService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type InputMode = 'scan' | 'paste';
type InputUnit = 'sats' | 'fiat';

interface DecodedInvoice {
  amountSats: number | null;
  description: string | null;
  expiry: number | null;
}

function decodeInvoice(bolt11: string): DecodedInvoice {
  try {
    const decoded = bolt11Decode(bolt11);
    let amountSats: number | null = null;
    let description: string | null = null;
    let expiry: number | null = null;

    for (const section of decoded.sections) {
      if (section.name === 'amount') {
        amountSats = Math.round(Number(section.value) / 1000);
      } else if (section.name === 'description') {
        description = section.value as string;
      } else if (section.name === 'expiry') {
        expiry = section.value as number;
      }
    }
    return { amountSats, description, expiry };
  } catch {
    return { amountSats: null, description: null, expiry: null };
  }
}

function isLightningAddress(input: string): boolean {
  return input.includes('@') && !input.startsWith('lnbc') && !input.startsWith('lntb');
}

function isValidInvoice(data: string): boolean {
  const lower = data.toLowerCase();
  return lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('ln');
}

const SendSheet: React.FC<Props> = ({ visible, onClose }) => {
  const { payInvoice, refreshBalance, balance, btcPrice, currency } = useWallet();
  const [permission, requestPermission] = useCameraPermissions();
  const [invoiceData, setInvoiceData] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<DecodedInvoice | null>(null);
  const [sending, setSending] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('scan');
  const [pasteText, setPasteText] = useState('');
  // Amount input for lightning addresses (no amount in invoice)
  const [satsValue, setSatsValue] = useState('');
  const [fiatValue, setFiatValue] = useState('');
  const [inputUnit, setInputUnit] = useState<InputUnit>('sats');
  const [lnurlParams, setLnurlParams] = useState<LnurlPayParams | null>(null);
  const [resolving, setResolving] = useState(false);
  const bottomSheetRef = useRef<BottomSheet>(null);

  const snapPoints = useMemo(() => ['90%'], []);

  const needsAmount = scanned && isLightningAddress(invoiceData || '');
  const currentSats = parseInt(satsValue) || 0;

  const fiatToSats = (fiat: number): number => {
    if (!btcPrice || btcPrice <= 0) return 0;
    return Math.round((fiat / btcPrice) * 100_000_000);
  };

  useEffect(() => {
    if (visible) {
      setInvoiceData(null);
      setDecoded(null);
      setScanned(false);
      setSending(false);
      setInputMode('scan');
      setPasteText('');
      setSatsValue('');
      setFiatValue('');
      setInputUnit('sats');
      setLnurlParams(null);
      setResolving(false);
      bottomSheetRef.current?.expand();
    } else {
      bottomSheetRef.current?.close();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [visible, onClose]);

  // Resolve lightning address when scanned
  useEffect(() => {
    if (!scanned || !invoiceData || !isLightningAddress(invoiceData)) return;
    let cancelled = false;
    (async () => {
      setResolving(true);
      try {
        const params = await resolveLightningAddress(invoiceData);
        if (!cancelled) {
          setLnurlParams(params);
          setDecoded(prev => ({
            ...prev!,
            description: params.description || prev?.description || null,
          }));
        }
      } catch (error) {
        if (!cancelled) {
          const msg = error instanceof Error ? error.message : 'Failed to resolve address';
          Alert.alert('Error', msg);
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => { cancelled = true; };
  }, [scanned, invoiceData]);

  const processInput = (data: string) => {
    let input = data.trim();
    if (input.toLowerCase().startsWith('lightning:')) {
      input = input.substring(10);
    }

    if (isLightningAddress(input)) {
      setInvoiceData(input);
      setDecoded({ amountSats: null, description: `Pay to ${input}`, expiry: null });
      setScanned(true);
    } else if (isValidInvoice(input)) {
      setInvoiceData(input);
      setDecoded(decodeInvoice(input));
      setScanned(true);
    }
  };

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    processInput(data);
  };

  const handlePaste = async () => {
    const clip = await Clipboard.getStringAsync();
    if (clip) {
      setPasteText(clip);
      processInput(clip);
    }
  };

  const handlePasteSubmit = () => {
    if (pasteText.trim()) {
      processInput(pasteText.trim());
    }
  };

  const handleSatsChange = (text: string) => {
    setSatsValue(text);
    const sats = parseInt(text) || 0;
    if (btcPrice) {
      setFiatValue(satsToFiat(sats, btcPrice).toFixed(2));
    } else {
      setFiatValue('0.00');
    }
  };

  const handleFiatChange = (text: string) => {
    setFiatValue(text);
    const fiat = parseFloat(text) || 0;
    const sats = fiatToSats(fiat);
    setSatsValue(sats.toString());
  };

  const handleSend = async () => {
    if (!invoiceData) return;
    setSending(true);
    try {
      if (isLightningAddress(invoiceData)) {
        if (!lnurlParams) {
          Alert.alert('Error', 'Lightning address not resolved yet. Please wait.');
          setSending(false);
          return;
        }
        if (currentSats <= 0) {
          Alert.alert('Error', 'Please enter an amount.');
          setSending(false);
          return;
        }
        if (currentSats < lnurlParams.minSats) {
          Alert.alert('Error', `Minimum amount is ${lnurlParams.minSats.toLocaleString()} sats.`);
          setSending(false);
          return;
        }
        if (currentSats > lnurlParams.maxSats) {
          Alert.alert('Error', `Maximum amount is ${lnurlParams.maxSats.toLocaleString()} sats.`);
          setSending(false);
          return;
        }
        // Fetch a bolt11 invoice from the LNURL-pay callback
        const bolt11 = await fetchInvoice(lnurlParams.callback, currentSats);
        await payInvoice(bolt11);
      } else {
        await payInvoice(invoiceData);
      }
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

  const handleReset = () => {
    setInvoiceData(null);
    setDecoded(null);
    setScanned(false);
    setPasteText('');
    setSatsValue('');
    setFiatValue('');
    setLnurlParams(null);
    setResolving(false);
  };

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) onClose();
  }, [onClose]);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
    []
  );

  if (!visible || !permission) return null;

  const canSend = needsAmount
    ? (lnurlParams && currentSats > 0 && !resolving)
    : !!invoiceData;

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
        <Text style={styles.title}>Send</Text>

        {/* Mode tabs */}
        {!scanned && (
          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tab, inputMode === 'scan' && styles.tabActive]}
              onPress={() => setInputMode('scan')}
            >
              <Text style={[styles.tabText, inputMode === 'scan' && styles.tabTextActive]}>
                Scan
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, inputMode === 'paste' && styles.tabActive]}
              onPress={() => setInputMode('paste')}
            >
              <Text style={[styles.tabText, inputMode === 'paste' && styles.tabTextActive]}>
                Paste
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Scanner or paste input */}
        {!scanned ? (
          inputMode === 'scan' ? (
            <View style={styles.cameraContainer}>
              {!permission.granted ? (
                <View style={styles.permissionContainer}>
                  <Text style={styles.permissionText}>Camera access needed to scan QR codes</Text>
                  <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                    <Text style={styles.permissionButtonText}>Grant Permission</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <CameraView
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={handleBarCodeScanned}
                />
              )}
            </View>
          ) : (
            <View style={styles.pasteSection}>
              <TextInput
                style={styles.pasteInput}
                placeholder="Paste invoice or lightning address..."
                placeholderTextColor={colors.textSupplementary}
                value={pasteText}
                onChangeText={setPasteText}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.pasteButtonRow}>
                <TouchableOpacity style={styles.pasteButton} onPress={handlePaste}>
                  <Text style={styles.pasteButtonText}>Paste from clipboard</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.goButton, !pasteText.trim() && styles.goButtonDisabled]}
                  onPress={handlePasteSubmit}
                  disabled={!pasteText.trim()}
                >
                  <Text style={styles.goButtonText}>Go</Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        ) : (
          /* Invoice/address detected - show details */
          <View style={styles.detailsCard}>
            {decoded?.description ? (
              <Text style={styles.detailDescription}>{decoded.description}</Text>
            ) : null}

            {needsAmount ? (
              /* Lightning address: show amount input */
              <View style={styles.amountSection}>
                {resolving ? (
                  <ActivityIndicator size="small" color={colors.brandPink} />
                ) : lnurlParams ? (
                  <>
                    <View style={styles.amountRow}>
                      <TextInput
                        style={styles.amountInput}
                        value={inputUnit === 'sats' ? satsValue : fiatValue}
                        onChangeText={inputUnit === 'sats' ? handleSatsChange : handleFiatChange}
                        keyboardType={inputUnit === 'sats' ? 'numeric' : 'decimal-pad'}
                        placeholder={inputUnit === 'sats' ? '0' : '0.00'}
                        placeholderTextColor={colors.textSupplementary}
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
                    <Text style={styles.rangeText}>
                      {lnurlParams.minSats.toLocaleString()} – {lnurlParams.maxSats.toLocaleString()} sats
                    </Text>
                  </>
                ) : null}
              </View>
            ) : decoded?.amountSats !== null && decoded?.amountSats !== undefined ? (
              /* Bolt11 with amount */
              <View style={styles.amountDisplay}>
                <Text style={styles.amountValue}>
                  {decoded.amountSats.toLocaleString()} sats
                </Text>
                {btcPrice ? (
                  <Text style={styles.amountFiat}>
                    {satsToFiatString(decoded.amountSats, btcPrice, currency)}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.amountValue}>Amount not specified</Text>
            )}

            {isLightningAddress(invoiceData || '') ? (
              <Text style={styles.detailAddress}>{invoiceData}</Text>
            ) : (
              <Text style={styles.invoiceText} numberOfLines={3}>{invoiceData}</Text>
            )}

            <TouchableOpacity onPress={handleReset}>
              <Text style={styles.resetText}>Scan / paste different invoice</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Balance */}
        {balance !== null && btcPrice !== null && (
          <Text style={styles.balanceText}>
            Balance: {balance.toLocaleString()} sats ({satsToFiatString(balance, btcPrice, currency)})
          </Text>
        )}

        {/* Action buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.cancelButton} onPress={() => { handleReset(); onClose(); }}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sendButton, (!canSend || sending) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!canSend || sending}
          >
            {sending ? (
              <ActivityIndicator color={colors.brandPink} />
            ) : (
              <Text style={styles.sendButtonText}>Send</Text>
            )}
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
    gap: 14,
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
  cameraContainer: {
    width: 240,
    height: 240,
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
  pasteSection: {
    width: '100%',
    gap: 12,
  },
  pasteInput: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    color: colors.textBody,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  pasteButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pasteButton: {
    flex: 1,
    backgroundColor: colors.divider,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pasteButtonText: {
    color: colors.textBody,
    fontSize: 14,
    fontWeight: '600',
  },
  goButton: {
    backgroundColor: colors.brandPink,
    height: 44,
    paddingHorizontal: 24,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  goButtonDisabled: {
    opacity: 0.5,
  },
  goButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  detailsCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    gap: 12,
  },
  detailDescription: {
    fontSize: 14,
    color: colors.textBody,
    textAlign: 'center',
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
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: 100,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.textBody,
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
  rangeText: {
    fontSize: 12,
    color: colors.textSupplementary,
  },
  amountDisplay: {
    alignItems: 'center',
    gap: 4,
  },
  amountValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.brandPink,
  },
  amountFiat: {
    fontSize: 16,
    color: colors.textSupplementary,
    fontWeight: '600',
  },
  detailAddress: {
    fontSize: 14,
    color: colors.brandPink,
    fontWeight: '600',
  },
  invoiceText: {
    color: colors.textSupplementary,
    fontSize: 11,
    textAlign: 'center',
  },
  resetText: {
    color: colors.brandPink,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
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
