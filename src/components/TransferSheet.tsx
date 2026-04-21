import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  BackHandler,
  Image,
  Keyboard,
  Linking,
  Platform,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import * as SecureStore from 'expo-secure-store';
import Toast from 'react-native-toast-message';
import * as swapRecoveryService from '../services/swapRecoveryService';
import { useWallet } from '../contexts/WalletContext';
import { colors } from '../styles/theme';
import { transferSheetStyles as styles } from '../styles/TransferSheet.styles';
import { satsToFiatString } from '../services/fiatService';
import { WalletState } from '../types/wallet';
import * as onchainService from '../services/onchainService';
import * as boltzService from '../services/boltzService';
import AmountEntryScreen from './AmountEntryScreen';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Step = 'main' | 'amount';

const TransferSheet: React.FC<Props> = ({ visible, onClose }) => {
  const {
    wallets,
    activeWalletId,
    btcPrice,
    currency,
    makeInvoiceForWallet,
    payInvoiceForWallet,
    refreshBalanceForWallet,
    fetchTransactionsForWallet,
    addPendingTransaction,
  } = useWallet();

  const [sourceId, setSourceId] = useState<string | null>(null);
  const [destId, setDestId] = useState<string | null>(null);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [destDropdownOpen, setDestDropdownOpen] = useState(false);
  const [satsValue, setSatsValue] = useState('');
  const [step, setStep] = useState<Step>('main');
  const [sending, setSending] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  // true once the foreground work is done and the background task has the
  // swap — the sheet becomes a "done, safe to close" confirmation state.
  const [handedOff, setHandedOff] = useState(false);
  const [feeEstimate, setFeeEstimate] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<any>(null);
  const snapPoints = useMemo(() => ['85%'], []);

  const currentSats = parseInt(satsValue) || 0;

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
      setFeeEstimate(`~${fee.toLocaleString()} sats \u00B7 ~10-60 min`);
    } else if (transferType === 'onchain-to-ln' && cachedBoltzFees) {
      const fee = boltzService.calculateSwapFee(currentSats, cachedBoltzFees);
      setFeeEstimate(`~${fee.toLocaleString()} sats \u00B7 ~10-60 min`);
    } else if (transferType === 'onchain-to-onchain') {
      onchainService
        .estimateOnchainFee()
        .then((fees) => {
          setFeeEstimate(`~${fees.medium.toLocaleString()} sats \u00B7 ~10-60 min`);
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
      setStep('main');
      setSending(false);
      setHandedOff(false);
      setProgressMsg(null);
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

  const handleTransfer = async () => {
    if (!sourceId || !destId || !source || !dest || currentSats <= 0) return;

    // Local flag shadowing the `handedOff` state — React setState is async,
    // so setHandedOff(true) before return doesn't update the `handedOff`
    // closure by the time the `finally` block runs. A plain let survives
    // the same scope and is visible in finally.
    let didHandOff = false;

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
        const confirmed = await new Promise<boolean | null>((resolve) =>
          Alert.alert(
            'Use Lightning wallet instead?',
            `"${altLnWallet.alias}" has ${altLnWallet.balance?.toLocaleString()} sats. Sending from a Lightning wallet avoids Boltz swap fees.`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
              { text: 'Use Lightning', onPress: () => resolve(true) },
              { text: 'Continue with on-chain', onPress: () => resolve(false) },
            ],
          ),
        );
        if (confirmed === null) return; // cancelled
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
        const confirmed = await new Promise<boolean | null>((resolve) =>
          Alert.alert(
            'Use on-chain wallet instead?',
            `"${altOnchainWallet.alias}" has ${altOnchainWallet.balance?.toLocaleString()} sats. Sending from an on-chain wallet avoids Boltz swap fees.`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
              { text: 'Use on-chain', onPress: () => resolve(true) },
              { text: 'Continue with Lightning', onPress: () => resolve(false) },
            ],
          ),
        );
        if (confirmed === null) return; // cancelled
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
    setProgressMsg('Preparing transfer...');
    console.log(
      `[Transfer] Starting ${transferType}: ${currentSats} sats from ${source.alias} to ${dest.alias}`,
    );

    // Add pending transactions to both wallets immediately
    const now = Math.floor(Date.now() / 1000);
    const swapLabel =
      transferType === 'ln-to-onchain' || transferType === 'onchain-to-ln'
        ? 'Boltz swap in progress'
        : 'Transfer in progress';
    addPendingTransaction(sourceId, {
      type: 'outgoing',
      amount: currentSats,
      description: swapLabel,
      created_at: now,
      settled_at: null,
    });
    addPendingTransaction(destId, {
      type: 'incoming',
      amount: currentSats,
      description: swapLabel,
      created_at: now,
      settled_at: null,
    });

    try {
      if (transferType === 'ln-to-ln') {
        setProgressMsg('Creating invoice...');
        const invoice = await makeInvoiceForWallet(destId, currentSats, 'Transfer');
        setProgressMsg('Sending payment...');
        await payInvoiceForWallet(sourceId, invoice);
      } else if (transferType === 'ln-to-onchain') {
        // Full Boltz reverse swap: LN → on-chain.
        // Foreground: create swap, persist, dispatch LN payment, dismiss sheet.
        // Background: wait for on-chain lockup, build & broadcast claim tx.
        setProgressMsg('Creating Boltz swap...');
        const address = await onchainService.getNextReceiveAddress(destId);
        const swap = await boltzService.createReverseSwap(address, currentSats);

        // Persist full swap state so the claim can be recovered if the
        // app crashes, is force-stopped, or the background task dies.
        await SecureStore.setItemAsync(
          `boltz_swap_${swap.id}`,
          JSON.stringify({
            id: swap.id,
            preimage: swap.preimage,
            claimPrivateKey: swap.claimPrivateKey,
            lockupAddress: swap.lockupAddress,
            destinationAddress: address,
            refundPublicKey: swap.refundPublicKey,
            swapTree: swap.swapTree,
          }),
        );
        await swapRecoveryService.registerPendingSwap(swap.id);

        // Kick off the Lightning payment + claim in the background so the
        // user can dismiss the sheet immediately. The swap is persisted, so
        // swapRecoveryService is the safety net if this task dies.
        const amount = currentSats;
        (async () => {
          try {
            await payInvoiceForWallet(sourceId, swap.invoice);
            Toast.show({
              type: 'info',
              text1: 'Lightning payment sent',
              text2: `Waiting for Boltz to lock ${amount.toLocaleString()} sats on-chain…`,
              position: 'top',
              visibilityTime: 5000,
            });
            const lockup = await boltzService.waitForLockup(swap.id, 900000);
            const claimed = await boltzService.claimSwap(swap, lockup, address);
            Toast.show({
              type: 'success',
              text1: 'Swap complete',
              text2: `${amount.toLocaleString()} sats sent on-chain. Claim tx ${claimed.slice(0, 10)}…`,
              position: 'top',
              visibilityTime: 10000,
            });
            await SecureStore.deleteItemAsync(`boltz_swap_${swap.id}`);
            await swapRecoveryService.unregisterPendingSwap(swap.id);
            try {
              await Promise.all([
                refreshBalanceForWallet(sourceId),
                refreshBalanceForWallet(destId),
                fetchTransactionsForWallet(sourceId),
                fetchTransactionsForWallet(destId),
              ]);
            } catch {}
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[Transfer] Background reverse swap failed:', msg);
            Toast.show({
              type: 'error',
              text1: 'Swap in progress',
              text2:
                'Background step hit an error — recovery will retry on next app launch. Funds are safe.',
              position: 'top',
              visibilityTime: 10000,
            });
          }
        })();

        // Show a terminal "underway" state with the Close button active so
        // the user can dismiss when they're ready. The background task runs
        // independently and will surface completion via toasts.
        setProgressMsg(
          'Swap underway — Lightning payment is being sent and Boltz will lock on-chain funds next.\n\n' +
            "Safe to close — you'll get a notification when the swap completes. " +
            'Progress also appears in your transaction history.',
        );
        didHandOff = true;
        setHandedOff(true);
        return;
      } else if (transferType === 'onchain-to-ln') {
        setProgressMsg('Creating Boltz swap...');
        const invoice = await makeInvoiceForWallet(destId, currentSats, 'Transfer');
        const swap = await boltzService.createSubmarineSwapForward(invoice);

        // Persist swap state for crash recovery + refund (includes all keys and scripts)
        await SecureStore.setItemAsync(
          `submarine_swap_${swap.id}`,
          JSON.stringify({
            id: swap.id,
            address: swap.address,
            expectedAmount: swap.expectedAmount,
            refundPrivateKey: swap.refundPrivateKey,
            claimPublicKey: swap.claimPublicKey,
            timeoutBlockHeight: swap.timeoutBlockHeight,
            swapTree: swap.swapTree,
            createdAt: Date.now(),
          }),
        );

        // Foreground: broadcast the on-chain tx (the user's action).
        // Background: wait for Boltz to pay the LN invoice, handle refund path.
        setProgressMsg('Broadcasting on-chain transaction...');
        console.log(
          `[Transfer] Sending ${swap.expectedAmount} sats on-chain to Boltz address ${swap.address}`,
        );
        await onchainService.sendTransaction(sourceId, swap.address, swap.expectedAmount);
        const submarineAmount = swap.expectedAmount;
        (async () => {
          try {
            await boltzService.waitForSubmarineSwapComplete(swap.id, 900000);
            Toast.show({
              type: 'success',
              text1: 'Swap complete',
              text2: `${submarineAmount.toLocaleString()} sats delivered via Lightning.`,
              position: 'top',
              visibilityTime: 10000,
            });
            await SecureStore.deleteItemAsync(`submarine_swap_${swap.id}`);
            try {
              await Promise.all([
                refreshBalanceForWallet(sourceId),
                refreshBalanceForWallet(destId),
                fetchTransactionsForWallet(sourceId),
                fetchTransactionsForWallet(destId),
              ]);
            } catch {}
          } catch (swapError) {
            const msg = swapError instanceof Error ? swapError.message : '';
            console.warn('[Transfer] Background submarine swap failed:', msg);
            if (
              msg.includes('swap.expired') ||
              msg.includes('invoice.failedToPay') ||
              msg.includes('transaction.lockupFailed')
            ) {
              const lockup = await boltzService.getSubmarineSwapLockup(swap.id);
              if (lockup) {
                const destAddr = await onchainService.getNextReceiveAddress(sourceId);
                Alert.alert(
                  'Swap Failed — Refund Available',
                  `The swap failed (${msg}). Your on-chain funds can be refunded after block ${swap.timeoutBlockHeight}.`,
                  [
                    {
                      text: 'Refund Now',
                      onPress: async () => {
                        try {
                          await boltzService.refundSwap(swap, lockup, destAddr);
                          await SecureStore.deleteItemAsync(`submarine_swap_${swap.id}`);
                          Toast.show({
                            type: 'success',
                            text1: 'Refund sent',
                            text2: 'Your refund transaction has been broadcast.',
                            position: 'top',
                            visibilityTime: 8000,
                          });
                        } catch (refundErr) {
                          Toast.show({
                            type: 'error',
                            text1: 'Refund failed',
                            text2: refundErr instanceof Error ? refundErr.message : 'Refund failed',
                            position: 'top',
                            visibilityTime: 10000,
                          });
                        }
                      },
                    },
                    { text: 'Later', style: 'cancel' },
                  ],
                );
              }
            } else {
              Toast.show({
                type: 'error',
                text1: 'Swap failed',
                text2: msg.slice(0, 140),
                position: 'top',
                visibilityTime: 10000,
              });
            }
          }
        })();

        // Terminal "underway" state — user closes when ready. Background
        // task will toast on completion/failure.
        setProgressMsg(
          'Swap underway — on-chain transaction broadcast. Boltz will pay the Lightning invoice next.\n\n' +
            "Safe to close — you'll get a notification when the swap completes. " +
            'Progress also appears in your transaction history.',
        );
        didHandOff = true;
        setHandedOff(true);
        return;
      } else if (transferType === 'onchain-to-onchain') {
        setProgressMsg('Sending on-chain transaction...');
        const address = await onchainService.getNextReceiveAddress(destId);
        await onchainService.sendTransaction(sourceId, address, currentSats);
      }

      setProgressMsg('Refreshing wallets...');

      // Refresh balances and transactions for both wallets (non-critical)
      try {
        await Promise.all([
          refreshBalanceForWallet(sourceId),
          refreshBalanceForWallet(destId),
          fetchTransactionsForWallet(sourceId),
          fetchTransactionsForWallet(destId),
        ]);
      } catch {
        console.warn('Post-transfer refresh failed — pull to refresh');
      }

      // Only ln-to-ln and onchain-to-onchain reach here — Boltz paths return
      // early after handing off to the background task.
      const settleMsg =
        transferType === 'onchain-to-onchain'
          ? `${currentSats.toLocaleString()} sats sent. On-chain funds will arrive after confirmation (~10-60 min).`
          : `${currentSats.toLocaleString()} sats transferred.`;

      Alert.alert('Transfer Complete', settleMsg, [{ text: 'OK', onPress: onClose }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer failed';
      // "Cannot read property 'reload' of undefined" comes from
      // react-native's HMRClient when Metro drops the dev-client
      // connection. It is NOT a transfer failure — nothing was signed
      // or broadcast. Surface it as a dev-mode hiccup with a clear
      // retry hint instead of a scary "Transfer Failed" alert.
      if (/reload.*of undefined|DevSettings/i.test(message)) {
        Alert.alert(
          'Development Reload Needed',
          'Metro disconnected from the app mid-transfer. No funds were moved. Relaunch the app (or reconnect Metro) and try again.',
          [{ text: 'OK' }],
        );
      } else {
        Alert.alert('Transfer Failed', message);
      }
    } finally {
      // When a Boltz swap has been handed off to a background IIFE we leave
      // the "Swap underway — safe to close" message visible so the user gets
      // explicit confirmation the transfer is in flight. They close the sheet
      // themselves via the Close button (see dismissal effect below). For
      // synchronous transfers (LN→LN, on-chain→on-chain) and errors, clear
      // state normally.
      if (!didHandOff) {
        setSending(false);
        setProgressMsg(null);
      }
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

  const isBoltzTransfer = transferType === 'ln-to-onchain' || transferType === 'onchain-to-ln';
  const belowBoltzMin =
    isBoltzTransfer && currentSats > 0 && currentSats < boltzService.BOLTZ_MIN_SATS;
  const canTransfer =
    sourceId && destId && currentSats > 0 && transferType !== null && !belowBoltzMin;

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
        {step === 'amount' ? (
          <AmountEntryScreen
            initialSats={currentSats}
            title="Transfer amount"
            subtitle={source && dest ? `${source.alias} → ${dest.alias}` : undefined}
            minSats={isBoltzTransfer ? boltzService.BOLTZ_MIN_SATS : undefined}
            confirmLabel="Done"
            backLabel="Back"
            onBack={() => setStep('main')}
            onConfirm={(sats) => {
              setSatsValue(String(sats));
              setStep('main');
            }}
            useBottomSheetInput
          />
        ) : (
          <>
            <Text style={styles.title}>Transfer</Text>

            {/* Source wallet selector */}
            {sending ? (
              /* Progress view — replaces form while transfer is executing */
              <View style={styles.progressView}>
                <Text style={styles.progressSummary}>{currentSats.toLocaleString()} sats</Text>
                <Text style={styles.progressRoute}>
                  {source?.alias} → {dest?.alias}
                </Text>
                {feeEstimate && (
                  <Text style={styles.feeText}>
                    Fee: {feeEstimate.split('\u00B7')[0].trim()}
                    {feeEstimate.includes('\u00B7')
                      ? ` · ${feeEstimate.split('\u00B7')[1].trim()}`
                      : ''}
                  </Text>
                )}
                <View style={styles.progressContainer}>
                  <ActivityIndicator size="small" color={colors.brandPink} />
                  <Text style={styles.progressText}>{progressMsg}</Text>
                </View>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  accessibilityLabel="Close"
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
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
                    <Text style={styles.dropdownArrow}>
                      {sourceDropdownOpen ? '\u25B2' : '\u25BC'}
                    </Text>
                  </TouchableOpacity>
                  {sourceDropdownOpen && (
                    <View style={styles.dropdownMenu}>
                      {sourceWallets.map((w) => (
                        <TouchableOpacity
                          key={w.id}
                          testID={`transfer-source-${w.id}`}
                          style={[
                            styles.dropdownItem,
                            sourceId === w.id && styles.dropdownItemActive,
                          ]}
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
                    <Text style={styles.dropdownArrow}>
                      {destDropdownOpen ? '\u25B2' : '\u25BC'}
                    </Text>
                  </TouchableOpacity>
                  {destDropdownOpen && (
                    <View style={styles.dropdownMenu}>
                      {destWallets.map((w) => (
                        <TouchableOpacity
                          key={w.id}
                          testID={`transfer-dest-${w.id}`}
                          style={[
                            styles.dropdownItem,
                            destId === w.id && styles.dropdownItemActive,
                          ]}
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

                {/* Amount picker — opens dedicated amount-entry step */}
                <Text style={styles.sectionLabel}>Amount</Text>
                <TouchableOpacity
                  style={styles.amountPickerRow}
                  onPress={() => setStep('amount')}
                  testID="transfer-amount-picker"
                  accessibilityLabel="Enter transfer amount"
                >
                  {currentSats > 0 ? (
                    <>
                      <Text style={styles.amountPickerValue}>
                        {currentSats.toLocaleString()} sats
                      </Text>
                      {btcPrice ? (
                        <Text style={styles.amountPickerFiat}>
                          {satsToFiatString(currentSats, btcPrice, currency)}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.amountPickerPlaceholder}>Enter amount</Text>
                  )}
                </TouchableOpacity>

                {/* Fee estimate */}
                {feeEstimate && (
                  <View style={styles.feeRow}>
                    {(transferType === 'ln-to-onchain' || transferType === 'onchain-to-ln') && (
                      <TouchableOpacity
                        onPress={() => Linking.openURL('https://boltz.exchange')}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Image
                          source={require('../../assets/images/boltz-logo.png')}
                          style={styles.boltzLogo}
                          resizeMode="contain"
                        />
                      </TouchableOpacity>
                    )}
                    <View>
                      <Text style={styles.feeText}>
                        Estimated fee: {feeEstimate.split('\u00B7')[0].trim()}
                      </Text>
                      {feeEstimate.includes('\u00B7') && (
                        <Text style={styles.feeText}>
                          Estimated time: {feeEstimate.split('\u00B7')[1].trim()}
                        </Text>
                      )}
                    </View>
                  </View>
                )}

                {/* Boltz minimum amount warning */}
                {belowBoltzMin && (
                  <Text style={styles.warningText}>
                    Boltz swaps require a minimum of {boltzService.BOLTZ_MIN_SATS.toLocaleString()}{' '}
                    sats.
                  </Text>
                )}

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
                    style={[
                      styles.transferButton,
                      (!canTransfer || sending) && styles.buttonDisabled,
                    ]}
                    onPress={handleTransfer}
                    disabled={!canTransfer || sending}
                    testID="transfer-execute"
                    accessibilityLabel="Execute transfer"
                  >
                    <Text style={styles.transferButtonText}>Transfer</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
};

export default TransferSheet;
