import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Share,
  TextInput,
  ActivityIndicator,
  BackHandler,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { ChevronUp, ChevronDown, Check } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import CopyIcon from './icons/CopyIcon';
import ShareIcon from './icons/ShareIcon';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '../contexts/WalletContext';
import { walletLabel } from '../types/wallet';
import { colors } from '../styles/theme';
import { receiveSheetStyles as styles } from '../styles/ReceiveSheet.styles';
import { satsToFiatString, satsToFiat } from '../services/fiatService';
// On-chain address fetching is done via WalletContext.getReceiveAddress

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Mode = 'address' | 'amount';
type InputUnit = 'sats' | 'fiat';

const ReceiveSheet: React.FC<Props> = ({ visible, onClose }) => {
  const {
    makeInvoiceForWallet,
    refreshBalanceForWallet,
    activeWalletId,
    activeWallet,
    wallets,
    btcPrice,
    currency,
    lightningAddress,
    getReceiveAddress,
  } = useWallet();
  const [capturedWalletId, setCapturedWalletId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('address');
  const [invoice, setInvoice] = useState('');
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [satsValue, setSatsValue] = useState('');
  const [fiatValue, setFiatValue] = useState('');
  const [inputUnit, setInputUnit] = useState<InputUnit>('sats');
  const [onchainAddress, setOnchainAddress] = useState<string | null>(null);
  const intervalId = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevBalance = useRef<number | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomSheetRef = useRef<BottomSheetModal>(null);

  const snapPoints = useMemo(() => ['85%'], []);

  const fiatToSats = (fiat: number): number => {
    if (!btcPrice || btcPrice <= 0) return 0;
    return Math.round((fiat / btcPrice) * 100_000_000);
  };

  const selectedWalletId = capturedWalletId ?? activeWalletId;
  const selectedWallet = useMemo(
    () => wallets.find((w) => w.id === selectedWalletId) ?? null,
    [wallets, selectedWalletId],
  );
  const walletName = selectedWallet ? walletLabel(selectedWallet) : 'Wallet';
  const balance = selectedWallet?.balance ?? null;

  const generateInvoice = useCallback(
    async (sats: number) => {
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
      setLoading(true);
      setPaymentReceived(false);
      try {
        const wId = capturedWalletId;
        if (!wId) return;
        const inv = await makeInvoiceForWallet(wId, sats, 'Lightning Piggy');
        setInvoice(inv);
        intervalId.current = setInterval(async () => {
          if (wId) await refreshBalanceForWallet(wId);
        }, 5000);
      } catch (error) {
        console.warn('Failed to create invoice:', error);
      } finally {
        setLoading(false);
      }
    },
    [makeInvoiceForWallet, refreshBalanceForWallet, capturedWalletId],
  );

  const isOnchainWallet = selectedWallet?.walletType === 'onchain';

  // Open/close the sheet — intentionally depends only on `visible`.
  // `balance` and `lightningAddress` are read for initialisation, not as reactive triggers.
  useEffect(() => {
    if (visible) {
      setCapturedWalletId(activeWalletId);
      setDropdownOpen(false);
      prevBalance.current = balance;
      setOnchainAddress(null);
      setSatsValue('');
      setFiatValue('');
      setInvoice('');
      setPaymentReceived(false);
      setInputUnit('sats');

      if (activeWallet?.walletType === 'onchain' && activeWalletId) {
        // On-chain wallet: fetch a receive address, default to address mode
        setMode('address');
        getReceiveAddress(activeWalletId)
          .then((addr) => setOnchainAddress(addr))
          .catch(() => {
            console.warn('Failed to fetch on-chain address');
          });
      } else {
        setMode(lightningAddress ? 'address' : 'amount');
      }

      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
    return () => {
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Reset state when wallet is changed via dropdown
  useEffect(() => {
    if (!visible || !capturedWalletId) return;
    setOnchainAddress(null);
    setInvoice('');
    setPaymentReceived(false);
    setSatsValue('');
    setFiatValue('');
    prevBalance.current = selectedWallet?.balance ?? null;
    if (intervalId.current) {
      clearInterval(intervalId.current);
      intervalId.current = null;
    }
    if (selectedWallet?.walletType === 'onchain') {
      setMode('address');
      getReceiveAddress(capturedWalletId)
        .then((addr) => setOnchainAddress(addr))
        .catch(() => {});
    } else {
      setMode(lightningAddress ? 'address' : 'amount');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturedWalletId]);

  // Detect payment by watching balance changes
  useEffect(() => {
    if (
      visible &&
      prevBalance.current !== null &&
      balance !== null &&
      balance > prevBalance.current
    ) {
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

  // BIP-21 URI for on-chain: optionally include amount
  const onchainUri = onchainAddress
    ? mode === 'amount' && currentSats > 0
      ? `bitcoin:${onchainAddress}?amount=${(currentSats / 100_000_000).toFixed(8)}`
      : `bitcoin:${onchainAddress}`
    : '';

  const copyValue = isOnchainWallet
    ? mode === 'amount' && currentSats > 0
      ? onchainUri
      : onchainAddress || ''
    : mode === 'address'
      ? lightningAddress || ''
      : invoice;

  const handleCopy = async () => {
    if (copyValue) await Clipboard.setStringAsync(copyValue);
  };

  const handleShare = async () => {
    if (copyValue) {
      try {
        const shareMsg = isOnchainWallet
          ? onchainUri
          : mode === 'address'
            ? `lightning:${lightningAddress}`
            : `lightning:${invoice}`;
        await Share.share({ message: shareMsg });
      } catch {}
    }
  };

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  if (!visible) return null;

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
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

            {/* Wallet selector */}
            {wallets.filter((w) => w.isConnected || w.walletType === 'onchain').length > 1 ? (
              <View style={styles.walletDropdownRow}>
                <Text style={styles.walletLabel}>To:</Text>
                <View style={styles.walletDropdownWrapper}>
                  <TouchableOpacity
                    style={styles.walletDropdown}
                    onPress={() => setDropdownOpen(!dropdownOpen)}
                  >
                    <Text style={styles.walletDropdownText}>{walletName}</Text>
                    {dropdownOpen ? (
                      <ChevronUp size={16} color={colors.white} />
                    ) : (
                      <ChevronDown size={16} color={colors.white} />
                    )}
                  </TouchableOpacity>
                  {dropdownOpen && (
                    <View style={styles.walletDropdownMenu}>
                      {wallets
                        .filter((w) => w.isConnected || w.walletType === 'onchain')
                        .map((w) => (
                          <TouchableOpacity
                            key={w.id}
                            style={[
                              styles.walletDropdownItem,
                              capturedWalletId === w.id && styles.walletDropdownItemActive,
                            ]}
                            onPress={() => {
                              setCapturedWalletId(w.id);
                              setDropdownOpen(false);
                            }}
                          >
                            <Text
                              style={[
                                styles.walletDropdownItemText,
                                capturedWalletId === w.id && styles.walletDropdownItemTextActive,
                              ]}
                            >
                              {walletLabel(w)}
                            </Text>
                          </TouchableOpacity>
                        ))}
                    </View>
                  )}
                </View>
              </View>
            ) : (
              <Text style={styles.walletLabel}>To: {walletName}</Text>
            )}

            {/* Mode tabs — show for on-chain wallets and NWC wallets with lightning address */}
            {isOnchainWallet || lightningAddress ? (
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
                    <Text
                      style={[
                        styles.unitButtonText,
                        inputUnit === 'sats' && styles.unitButtonTextActive,
                      ]}
                    >
                      Sats
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.unitButton, inputUnit === 'fiat' && styles.unitButtonActive]}
                    onPress={() => setInputUnit('fiat')}
                  >
                    <Text
                      style={[
                        styles.unitButtonText,
                        inputUnit === 'fiat' && styles.unitButtonTextActive,
                      ]}
                    >
                      {currency}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.convertedAmount}>
                  {inputUnit === 'sats'
                    ? btcPrice && currentSats > 0
                      ? satsToFiatString(currentSats, btcPrice, currency)
                      : ''
                    : currentSats > 0
                      ? `${currentSats.toLocaleString()} sats`
                      : ''}
                </Text>
              </View>
            ) : null}

            {/* QR Code */}
            <View style={styles.qrContainer}>
              {isOnchainWallet && onchainAddress && (mode === 'address' || currentSats > 0) ? (
                <View>
                  <QRCode value={onchainUri} size={200} />
                  {paymentReceived && (
                    <View style={styles.checkmark}>
                      <Text style={styles.checkmarkText}>{'\u2713'}</Text>
                    </View>
                  )}
                </View>
              ) : isOnchainWallet && mode === 'amount' && currentSats === 0 ? (
                <Text style={styles.noInvoice}>Enter an amount to generate QR code</Text>
              ) : mode === 'address' && lightningAddress ? (
                <View>
                  <QRCode value={`lightning:${lightningAddress}`} size={200} />
                  {paymentReceived && (
                    <View style={styles.checkmark}>
                      <Check size={28} color={colors.white} />
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
                      <Check size={28} color={colors.white} />
                    </View>
                  )}
                </View>
              ) : (
                <Text style={styles.noInvoice}>
                  {mode === 'address'
                    ? 'No lightning address set'
                    : 'Enter an amount to generate invoice'}
                </Text>
              )}
            </View>

            <Text style={styles.qrLabel}>
              {isOnchainWallet && onchainAddress && !(mode === 'amount' && currentSats > 0) ? (
                <>
                  <Text style={styles.addressHighlight}>{onchainAddress.slice(0, 6)}</Text>
                  {onchainAddress.slice(6, -6)}
                  <Text style={styles.addressHighlight}>{onchainAddress.slice(-6)}</Text>
                </>
              ) : isOnchainWallet ? (
                mode === 'amount' && currentSats > 0 ? (
                  `${currentSats.toLocaleString()} sats`
                ) : (
                  'Loading address...'
                )
              ) : mode === 'address' ? (
                lightningAddress
              ) : (
                'Lightning invoice'
              )}
            </Text>
            {mode === 'amount' && invoice ? (
              <Text style={styles.invoiceText} numberOfLines={2}>
                {invoice}
              </Text>
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
    </BottomSheetModal>
  );
};

export default ReceiveSheet;
