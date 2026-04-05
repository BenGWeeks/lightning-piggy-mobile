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
  Platform,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import * as SecureStore from 'expo-secure-store';
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
    activeWalletId,
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
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<any>(null);
  const snapPoints = useMemo(() => ['85%'], []);

  const currentSats = parseInt(satsValue) || 0;

  const fiatToSats = (fiat: number): number => {
    if (!btcPrice || btcPrice <= 0) return 0;
    return Math.round((fiat / btcPrice) * 100_000_000);
  };

  const source = useMemo(() => wallets.find((w) => w.id === sourceId) ?? null, [wallets, sourceId]);
  const dest = useMemo(() => wallets.find((w) => w.id === destId) ?? null, [wallets, destId]);

  // Available wallets for source: NWC wallets that are connected, or hot wallets (mnemonic)
  // Available wallets for source: NWC wallets that are connected, or hot wallets (mnemonic)
  const sourceWallets = useMemo(
    () =>
      wallets.filter(
        (w) =>
          (w.walletType === 'nwc' && w.isConnected) ||
          (w.walletType === 'onchain' && w.onchainImportMethod === 'mnemonic'),
      ),
    [wallets],
  );

  // Available wallets for destination: exclude source, only show connected NWC or on-chain
  const destWallets = useMemo(
    () => wallets.filter((w) => w.id !== sourceId && (w.walletType === 'onchain' || w.isConnected)),
    [wallets, sourceId],
  );

  // Determine transfer type
  const transferType = useMemo(() => {
    if (!source || !dest) return null;
    if (source.walletType === 'nwc' && dest.walletType === 'nwc') return 'ln-to-ln';
    if (source.walletType === 'nwc' && dest.walletType === 'onchain') return 'ln-to-onchain';
    if (source.walletType === 'onchain' && dest.walletType === 'onchain')
      return 'onchain-to-onchain';
    if (source.walletType === 'onchain' && dest.walletType === 'nwc') return 'onchain-to-ln';
    return null;
  }, [source, dest]);

  // Cache Boltz fees — fetch once when transfer type changes, not per keystroke
  const [cachedBoltzFees, setCachedBoltzFees] = useState<boltzService.SwapFees | null>(null);

  useEffect(() => {
    if (transferType === 'ln-to-onchain') {
      let cancelled = false;
      boltzService
        .getReverseSwapFees()
        .then((fees) => {
          if (!cancelled) setCachedBoltzFees(fees);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    } else if (transferType === 'onchain-to-ln') {
      let cancelled = false;
      boltzService
        .getSubmarineSwapFees()
        .then((fees) => {
          if (!cancelled) setCachedBoltzFees(fees);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    } else {
      setCachedBoltzFees(null);
    }
  }, [transferType]);

  // Update fee estimate display based on cached fees + current amount
  useEffect(() => {
    if (!transferType || currentSats <= 0) {
      setFeeEstimate(null);
      return;
    }
    if (transferType === 'ln-to-ln') {
      setFeeEstimate('~0 sats \u00B7 Instant (Lightning)');
    } else if (transferType === 'ln-to-onchain' && cachedBoltzFees) {
      const fee = boltzService.calculateSwapFee(currentSats, cachedBoltzFees);
      setFeeEstimate(`~${fee.toLocaleString()} sats \u00B7 ~10-60 min (on-chain)`);
    } else if (transferType === 'onchain-to-ln' && cachedBoltzFees) {
      const fee = boltzService.calculateSwapFee(currentSats, cachedBoltzFees);
      setFeeEstimate(`~${fee.toLocaleString()} sats \u00B7 ~10-60 min (Boltz swap)`);
    } else if (transferType === 'onchain-to-onchain') {
      onchainService
        .estimateOnchainFee()
        .then((fees) => {
          setFeeEstimate(`~${fees.medium.toLocaleString()} sats \u00B7 ~10-60 min (on-chain)`);
        })
        .catch(() => {
          setFeeEstimate('Fee estimate unavailable');
        });
    }
  }, [transferType, currentSats, cachedBoltzFees]);

  useEffect(() => {
    if (visible) {
      const activeW = wallets.find((w) => w.id === activeWalletId);
      const isWatchOnly =
        activeW?.walletType === 'onchain' && activeW?.onchainImportMethod !== 'mnemonic';
      const canSendFromActive = activeW && sourceWallets.some((w) => w.id === activeW.id);

      let defaultSource: string | null;
      let defaultDest: string | null;

      if (isWatchOnly && activeWalletId) {
        // Watch-only: default as destination, pick first sendable wallet as source
        defaultDest = activeWalletId;
        defaultSource = sourceWallets.find((w) => w.id !== activeWalletId)?.id ?? null;
      } else if (canSendFromActive && activeWalletId) {
        // Active wallet can send: use it as source
        defaultSource = activeWalletId;
        defaultDest =
          wallets.find((w) => w.id !== activeWalletId && w.walletType === 'nwc' && w.isConnected)
            ?.id ??
          wallets.find((w) => w.id !== activeWalletId)?.id ??
          null;
      } else {
        // Fallback: first sendable wallet as source
        defaultSource = sourceWallets.length > 0 ? sourceWallets[0].id : null;
        defaultDest =
          wallets.find((w) => w.id !== defaultSource && w.walletType === 'nwc' && w.isConnected)
            ?.id ??
          wallets.find((w) => w.id !== defaultSource)?.id ??
          null;
      }

      setSourceId(defaultSource);
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

  // Track keyboard height for dynamic padding (matches NostrLoginSheet pattern)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 100);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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

    // Warn if doing a cross-chain swap when a same-chain wallet has funds
    if (transferType === 'onchain-to-ln') {
      const altLnWallet =
        wallets
          .filter(
            (w) =>
              w.id !== sourceId &&
              w.walletType === 'nwc' &&
              w.isConnected &&
              (w.balance ?? 0) >= currentSats,
          )
          .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))[0] ?? null;
      if (altLnWallet) {
        const confirmed = await new Promise<boolean>((resolve) =>
          Alert.alert(
            'Use Lightning wallet instead?',
            `"${altLnWallet.alias}" has ${altLnWallet.balance?.toLocaleString()} sats. Sending from a Lightning wallet avoids Boltz swap fees.`,
            [
              { text: 'Use Lightning', onPress: () => resolve(true), style: 'cancel' },
              { text: 'Continue with on-chain', onPress: () => resolve(false) },
            ],
          ),
        );
        if (confirmed) {
          setSourceId(altLnWallet.id);
          return;
        }
      }
    } else if (transferType === 'ln-to-onchain') {
      const altOnchainWallet =
        wallets
          .filter(
            (w) =>
              w.id !== sourceId &&
              w.walletType === 'onchain' &&
              w.onchainImportMethod === 'mnemonic' &&
              (w.balance ?? 0) >= currentSats,
          )
          .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))[0] ?? null;
      if (altOnchainWallet) {
        const confirmed = await new Promise<boolean>((resolve) =>
          Alert.alert(
            'Use on-chain wallet instead?',
            `"${altOnchainWallet.alias}" has ${altOnchainWallet.balance?.toLocaleString()} sats. Sending from an on-chain wallet avoids Boltz swap fees.`,
            [
              { text: 'Use on-chain', onPress: () => resolve(true), style: 'cancel' },
              { text: 'Continue with Lightning', onPress: () => resolve(false) },
            ],
          ),
        );
        if (confirmed) {
          setSourceId(altOnchainWallet.id);
          return;
        }
      }
    }

    // Validate Boltz minimum amount for cross-chain transfers
    if ((transferType === 'ln-to-onchain' || transferType === 'onchain-to-ln') && cachedBoltzFees) {
      if (currentSats < cachedBoltzFees.minAmount) {
        Alert.alert(
          'Amount Too Low',
          `Boltz swap minimum is ${cachedBoltzFees.minAmount.toLocaleString()} sats.`,
        );
        return;
      }
      if (currentSats > cachedBoltzFees.maxAmount) {
        Alert.alert(
          'Amount Too High',
          `Boltz swap maximum is ${cachedBoltzFees.maxAmount.toLocaleString()} sats.`,
        );
        return;
      }
    }

    setSending(true);
    try {
      if (transferType === 'ln-to-ln') {
        // Generate invoice on destination, pay from source
        const invoice = await makeInvoiceForWallet(destId, currentSats, 'Transfer');
        await payInvoiceForWallet(sourceId, invoice);
      } else if (transferType === 'ln-to-onchain') {
        // Full Boltz reverse swap: LN → on-chain
        const address = await onchainService.getNextReceiveAddress(destId);
        const swap = await boltzService.createReverseSwap(address, currentSats);

        // Persist swap state to SecureStore for crash recovery (TODO #38)
        await SecureStore.setItemAsync(
          `boltz_swap_${swap.id}`,
          JSON.stringify({
            id: swap.id,
            preimage: swap.preimage,
            claimPrivateKey: swap.claimPrivateKey,
            lockupAddress: swap.lockupAddress,
            destinationAddress: address,
          }),
        );

        // Step 1: Pay the Lightning invoice
        await payInvoiceForWallet(sourceId, swap.invoice);

        // Step 2: Wait for Boltz to lock BTC on-chain (polls every 3s)
        const lockup = await boltzService.waitForLockup(swap.id, 900000); // 15 min — Boltz needs to lock on-chain

        // Step 3: Build and broadcast the script-path claim transaction
        await boltzService.claimSwap(swap, lockup, address);

        // Clean up persisted swap state on success
        await SecureStore.deleteItemAsync(`boltz_swap_${swap.id}`);
      } else if (transferType === 'onchain-to-ln') {
        // Boltz submarine swap: on-chain → Lightning
        const invoice = await makeInvoiceForWallet(destId, currentSats, 'Transfer');
        const swap = await boltzService.createSubmarineSwapForward(invoice);

        // Persist swap state for crash recovery (includes refund key for failed swaps)
        await SecureStore.setItemAsync(
          `submarine_swap_${swap.id}`,
          JSON.stringify({
            id: swap.id,
            address: swap.address,
            expectedAmount: swap.expectedAmount,
            refundPrivateKey: swap.refundPrivateKey,
            timeoutBlockHeight: swap.timeoutBlockHeight,
            createdAt: Date.now(),
          }),
        );

        await onchainService.sendTransaction(sourceId, swap.address, swap.expectedAmount);
        await boltzService.waitForSubmarineSwapComplete(swap.id, 900000); // 15 min — needs on-chain confirmation

        // Clean up persisted swap state on success
        await SecureStore.deleteItemAsync(`submarine_swap_${swap.id}`);
      } else if (transferType === 'onchain-to-onchain') {
        // Direct on-chain send from hot wallet
        const address = await onchainService.getNextReceiveAddress(destId);
        await onchainService.sendTransaction(sourceId, address, currentSats);
      }

      // Refresh both balances (non-critical — transfer already succeeded)
      try {
        await Promise.all([refreshBalanceForWallet(sourceId), refreshBalanceForWallet(destId)]);
      } catch {
        console.warn('Balance refresh failed after transfer — pull to refresh');
      }

      const settleMsg =
        transferType === 'ln-to-onchain' || transferType === 'onchain-to-onchain'
          ? `${currentSats.toLocaleString()} sats sent. On-chain funds will arrive after confirmation (~10-60 min).`
          : transferType === 'onchain-to-ln'
            ? `${currentSats.toLocaleString()} sats sent via Boltz swap.`
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
    const balanceStr = w.balance !== null ? ` · ${w.balance.toLocaleString()} sats` : '';
    const typeStr = w.walletType === 'onchain' ? 'on-chain' : 'lightning';
    return `${w.alias} (${typeStr})${balanceStr}`;
  };

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      onChange={handleSheetChange}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={{
          ...styles.innerContent,
          paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 40,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Transfer</Text>

        {/* Source wallet selector */}
        <Text style={styles.sectionLabel}>From</Text>
        <View style={[styles.dropdownWrapper, sourceDropdownOpen && { zIndex: 20 }]}>
          <TouchableOpacity
            style={styles.dropdown}
            onPress={() => {
              setSourceDropdownOpen(!sourceDropdownOpen);
              setDestDropdownOpen(false);
            }}
            testID="transfer-source-dropdown"
            accessibilityLabel="Source wallet"
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
                  testID={`transfer-source-${w.alias.replace(/\s+/g, '-').toLowerCase()}`}
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
                <Text style={styles.dropdownEmpty}>No wallets that can send</Text>
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
                  testID={`transfer-dest-${w.alias.replace(/\s+/g, '-').toLowerCase()}`}
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
              style={[styles.unitButtonText, inputUnit === 'sats' && styles.unitButtonTextActive]}
            >
              Sats
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.unitButton, inputUnit === 'fiat' && styles.unitButtonActive]}
            onPress={() => setInputUnit('fiat')}
          >
            <Text
              style={[styles.unitButtonText, inputUnit === 'fiat' && styles.unitButtonTextActive]}
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
        {source?.walletType === 'onchain' && source?.onchainImportMethod !== 'mnemonic' && (
          <Text style={styles.warningText}>
            Watch-only wallets cannot send. Select a different wallet as source.
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
      </BottomSheetScrollView>
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
    marginTop: 4,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.divider,
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
