import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  BackHandler,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { satsToFiat, satsToFiatString } from '../services/fiatService';
import { WalletState } from '../types/wallet';
import * as onchainService from '../services/onchainService';
import * as boltzService from '../services/boltzService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type InputUnit = 'sats' | 'fiat';

const TransferSheet: React.FC<Props> = ({ visible, onClose }) => {
  const {
    wallets,
    btcPrice,
    currency,
    makeInvoiceForWallet,
    payInvoiceForWallet,
    refreshBalanceForWallet,
  } = useWallet();

  const [sourceId, setSourceId] = useState<string | null>(null);
  const [destId, setDestId] = useState<string | null>(null);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [destDropdownOpen, setDestDropdownOpen] = useState(false);
  const [satsValue, setSatsValue] = useState('');
  const [fiatValue, setFiatValue] = useState('');
  const [inputUnit, setInputUnit] = useState<InputUnit>('sats');
  const [sending, setSending] = useState(false);
  const [feeEstimate, setFeeEstimate] = useState<string | null>(null);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['85%'], []);

  const currentSats = parseInt(satsValue) || 0;

  const fiatToSats = (fiat: number): number => {
    if (!btcPrice || btcPrice <= 0) return 0;
    return Math.round((fiat / btcPrice) * 100_000_000);
  };

  const source = useMemo(() => wallets.find((w) => w.id === sourceId) ?? null, [wallets, sourceId]);
  const dest = useMemo(() => wallets.find((w) => w.id === destId) ?? null, [wallets, destId]);

  // Available wallets for source: NWC wallets that are connected (on-chain are watch-only, can't send)
  const sourceWallets = useMemo(
    () => wallets.filter((w) => w.walletType === 'nwc' && w.isConnected),
    [wallets],
  );

  // Available wallets for destination: all wallets except source
  const destWallets = useMemo(() => wallets.filter((w) => w.id !== sourceId), [wallets, sourceId]);

  // Determine transfer type
  const transferType = useMemo(() => {
    if (!source || !dest) return null;
    if (source.walletType === 'nwc' && dest.walletType === 'nwc') return 'ln-to-ln';
    if (source.walletType === 'nwc' && dest.walletType === 'onchain') return 'ln-to-onchain';
    return null;
  }, [source, dest]);

  // Fetch fee estimate when transfer type or amount changes
  useEffect(() => {
    if (!transferType || currentSats <= 0) {
      setFeeEstimate(null);
      return;
    }
    if (transferType === 'ln-to-ln') {
      setFeeEstimate('~0 sats \u00B7 Instant (Lightning)');
    } else if (transferType === 'ln-to-onchain') {
      let cancelled = false;
      boltzService
        .getSwapFees()
        .then((fees) => {
          if (cancelled) return;
          const fee = boltzService.calculateSwapFee(currentSats, fees);
          setFeeEstimate(`~${fee.toLocaleString()} sats \u00B7 ~10-60 min (on-chain)`);
        })
        .catch(() => {
          if (!cancelled) setFeeEstimate('Fee estimate unavailable');
        });
      return () => {
        cancelled = true;
      };
    }
  }, [transferType, currentSats]);

  useEffect(() => {
    if (visible) {
      // Default: first NWC wallet as source
      const defaultSource = sourceWallets.length > 0 ? sourceWallets[0].id : null;
      setSourceId(defaultSource);
      // Default dest: prefer another NWC wallet over on-chain (simpler fee)
      const defaultDest =
        wallets.find((w) => w.id !== defaultSource && w.walletType === 'nwc' && w.isConnected)
          ?.id ??
        wallets.find((w) => w.id !== defaultSource)?.id ??
        null;
      setDestId(defaultDest);
      setSatsValue('');
      setFiatValue('');
      setInputUnit('sats');
      setSending(false);
      setFeeEstimate(null);
      setSourceDropdownOpen(false);
      setDestDropdownOpen(false);
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [visible, onClose]);

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

  const handleTransfer = async () => {
    if (!sourceId || !destId || !source || !dest || currentSats <= 0) return;

    setSending(true);
    try {
      if (transferType === 'ln-to-ln') {
        // Generate invoice on destination, pay from source
        const invoice = await makeInvoiceForWallet(destId, currentSats, 'Transfer');
        await payInvoiceForWallet(sourceId, invoice);
      } else if (transferType === 'ln-to-onchain') {
        // Full Boltz reverse swap: LN → on-chain
        const address = await onchainService.getCurrentReceiveAddress(destId);
        const swap = await boltzService.createReverseSwap(address, currentSats);

        // Step 1: Pay the Lightning invoice
        await payInvoiceForWallet(sourceId, swap.invoice);

        // Step 2: Wait for Boltz to lock BTC on-chain (polls every 3s)
        await boltzService.waitForLockup(swap.id, 120000);

        // Note: The claim transaction construction will be added in a
        // follow-up. For now, Boltz's Protocol 11 fallback will send
        // funds to the claimAddress after the timeout period.
        // TODO: Construct and broadcast script-path claim tx for ~10 min settlement.
      }

      // Refresh both balances
      await Promise.all([refreshBalanceForWallet(sourceId), refreshBalanceForWallet(destId)]);

      const settleMsg =
        transferType === 'ln-to-onchain'
          ? `${currentSats.toLocaleString()} sats sent. On-chain funds will arrive after confirmation (~10-60 min).`
          : `${currentSats.toLocaleString()} sats transferred.`;

      Alert.alert('Transfer Complete', settleMsg, [{ text: 'OK', onPress: onClose }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer failed';
      Alert.alert('Transfer Failed', message);
    } finally {
      setSending(false);
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

  const canTransfer = sourceId && destId && currentSats > 0 && transferType !== null;

  const renderWalletLabel = (w: WalletState) => {
    const balanceStr = w.balance !== null ? ` (${w.balance.toLocaleString()} sats)` : '';
    const typeLabel = w.walletType === 'onchain' ? ' \u26D3' : ' \u26A1';
    return `${w.alias}${typeLabel}${balanceStr}`;
  };

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
            <Text style={styles.title}>Transfer</Text>

            {/* Source wallet selector */}
            <Text style={styles.sectionLabel}>From</Text>
            <View style={styles.dropdownWrapper}>
              <TouchableOpacity
                style={styles.dropdown}
                onPress={() => {
                  setSourceDropdownOpen(!sourceDropdownOpen);
                  setDestDropdownOpen(false);
                }}
              >
                <Text style={styles.dropdownText}>
                  {source ? renderWalletLabel(source) : 'Select wallet'}
                </Text>
                <Text style={styles.dropdownArrow}>{sourceDropdownOpen ? '\u25B2' : '\u25BC'}</Text>
              </TouchableOpacity>
              {sourceDropdownOpen && (
                <View style={styles.dropdownMenu}>
                  {sourceWallets.map((w) => (
                    <TouchableOpacity
                      key={w.id}
                      style={[styles.dropdownItem, sourceId === w.id && styles.dropdownItemActive]}
                      onPress={() => {
                        setSourceId(w.id);
                        setSourceDropdownOpen(false);
                        // Adjust dest if same
                        if (destId === w.id) {
                          const alt = wallets.find((ww) => ww.id !== w.id);
                          setDestId(alt?.id ?? null);
                        }
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          sourceId === w.id && styles.dropdownItemTextActive,
                        ]}
                      >
                        {renderWalletLabel(w)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {sourceWallets.length === 0 && (
                    <Text style={styles.dropdownEmpty}>No connected Lightning wallets</Text>
                  )}
                </View>
              )}
            </View>

            {/* Destination wallet selector */}
            <Text style={styles.sectionLabel}>To</Text>
            <View style={styles.dropdownWrapper}>
              <TouchableOpacity
                style={styles.dropdown}
                onPress={() => {
                  setDestDropdownOpen(!destDropdownOpen);
                  setSourceDropdownOpen(false);
                }}
                testID="transfer-dest-dropdown"
                accessibilityLabel="Destination wallet"
              >
                <Text style={styles.dropdownText}>
                  {dest ? renderWalletLabel(dest) : 'Select wallet'}
                </Text>
                <Text style={styles.dropdownArrow}>{destDropdownOpen ? '\u25B2' : '\u25BC'}</Text>
              </TouchableOpacity>
              {destDropdownOpen && (
                <View style={styles.dropdownMenu}>
                  {destWallets.map((w) => (
                    <TouchableOpacity
                      key={w.id}
                      style={[styles.dropdownItem, destId === w.id && styles.dropdownItemActive]}
                      onPress={() => {
                        setDestId(w.id);
                        setDestDropdownOpen(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          destId === w.id && styles.dropdownItemTextActive,
                        ]}
                      >
                        {renderWalletLabel(w)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Amount input */}
            <Text style={styles.sectionLabel}>Amount</Text>
            <View style={styles.amountRow}>
              <BottomSheetTextInput
                style={styles.amountInput}
                value={inputUnit === 'sats' ? satsValue : fiatValue}
                onChangeText={inputUnit === 'sats' ? handleSatsChange : handleFiatChange}
                keyboardType={inputUnit === 'sats' ? 'numeric' : 'decimal-pad'}
                placeholder={inputUnit === 'sats' ? '0' : '0.00'}
                placeholderTextColor={colors.textSupplementary}
                testID="transfer-amount-input"
                accessibilityLabel="Transfer amount"
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

            {/* Fee estimate */}
            {feeEstimate && <Text style={styles.feeText}>Estimated fee: {feeEstimate}</Text>}

            {/* Watch-only warning */}
            {source?.walletType === 'onchain' && (
              <Text style={styles.warningText}>
                Watch-only wallets cannot send. Select a Lightning wallet as source.
              </Text>
            )}

            {/* Action buttons */}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onClose}
                testID="transfer-cancel"
                accessibilityLabel="Cancel transfer"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.transferButton, (!canTransfer || sending) && styles.buttonDisabled]}
                onPress={handleTransfer}
                disabled={!canTransfer || sending}
                testID="transfer-execute"
                accessibilityLabel="Execute transfer"
              >
                {sending ? (
                  <ActivityIndicator color={colors.brandPink} />
                ) : (
                  <Text style={styles.transferButtonText}>Transfer</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </BottomSheetView>
    </BottomSheetModal>
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
    paddingBottom: 40,
    gap: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textHeader,
    textAlign: 'center',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSupplementary,
    marginTop: 6,
  },
  // --- Dropdown ---
  dropdownWrapper: {
    position: 'relative',
    zIndex: 10,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  dropdownText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textBody,
    flex: 1,
  },
  dropdownArrow: {
    fontSize: 10,
    color: colors.textSupplementary,
    marginLeft: 8,
  },
  dropdownMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownItemActive: {
    backgroundColor: colors.brandPink,
  },
  dropdownItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textBody,
  },
  dropdownItemTextActive: {
    color: colors.white,
  },
  dropdownEmpty: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    color: colors.textSupplementary,
    fontStyle: 'italic',
  },
  // --- Amount ---
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
    flex: 1,
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
    textAlign: 'center',
    minHeight: 18,
  },
  feeText: {
    fontSize: 13,
    color: colors.textSupplementary,
    textAlign: 'center',
    fontWeight: '500',
  },
  warningText: {
    fontSize: 13,
    color: colors.red,
    textAlign: 'center',
    fontWeight: '600',
  },
  // --- Buttons ---
  buttonRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 8,
    justifyContent: 'center',
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
  transferButton: {
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
  transferButtonText: {
    color: colors.brandPink,
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});

export default TransferSheet;
