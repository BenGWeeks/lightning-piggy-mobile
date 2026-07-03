/**
 * BoltzReceiveSheet — issue #92.
 *
 * Receive on-chain Bitcoin into a Lightning (NWC) wallet via a Boltz
 * forward submarine swap. The external sender pays the displayed BIP-21
 * lockup address; Boltz then pays the user's Lightning invoice.
 *
 * This is the symmetric counterpart of the existing reverse-swap path
 * (LN → on-chain) used by `TransferSheet`. The forward submarine flow is
 * the same one TransferSheet already uses internally for the user's own
 * "on-chain wallet → LN wallet" transfer — but here the on-chain payer
 * is *external*, so the sheet's job is to:
 *   1. Generate an LN invoice on the user's NWC wallet for `amountSats`.
 *   2. Hand it to Boltz to create a submarine swap.
 *   3. Display Boltz's lockup address as a BIP-21 QR for the sender.
 *   4. Watch the swap's status and update the UI through 4 buckets:
 *      awaiting-payment / detected / paying-invoice / complete | failed.
 *   5. On `failed`, surface a Refund button that broadcasts a refund tx
 *      to a fresh address from the user's first available on-chain
 *      wallet (matches the pattern in TransferSheet's onchain-to-LN
 *      branch). The swap is also persisted to SecureStore so
 *      `swapRecoveryService` can finish the refund on next launch if the
 *      app dies mid-swap.
 *
 * Refund-handling design (the most important call) — see PR description
 * for full rationale; the short version is: persist
 * `submarine_swap_<id>` *with* a fresh `refundDestinationAddress` so
 * `swapRecoveryService.recoverPendingSwaps()` can auto-broadcast on next
 * launch with no user input. Without that, a missed refund window on a
 * dropped foreground task means permanent loss.
 */

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Share,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { ChevronLeft, Copy, Share2, Check, AlertTriangle } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import Toast from './BrandedToast';
import { useWallet, useWalletLive } from '../contexts/WalletContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { walletLabel } from '../types/wallet';
import { createBoltzReceiveSheetStyles } from '../styles/BoltzReceiveSheet.styles';
import { satsToFiat, formatFiat } from '../services/fiatService';
import AmountEntryScreen from './AmountEntryScreen';
import * as boltzService from '../services/boltzService';
import * as swapRecoveryService from '../services/swapRecoveryService';
import * as onchainService from '../services/onchainService';
import { getDefaultOnchainWalletId } from '../services/walletStorageService';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The NWC wallet that will receive the Lightning side of the swap. */
  walletId: string | null;
}

type Step = 'amount' | 'qr';

const BoltzReceiveSheet: React.FC<Props> = ({ visible, onClose, walletId }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createBoltzReceiveSheetStyles(colors), [colors]);
  const { wallets, makeInvoiceForWallet, refreshBalanceForWallet, currency } = useWallet();
  const { btcPrice } = useWalletLive();

  const wallet = useMemo(() => wallets.find((w) => w.id === walletId) ?? null, [wallets, walletId]);

  const [step, setStep] = useState<Step>('amount');
  const [amountSats, setAmountSats] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Swap state — populated after createSubmarineSwapForward returns.
  const [swap, setSwap] = useState<boltzService.SubmarineSwapResult | null>(null);
  const [phase, setPhase] = useState<boltzService.SubmarineSwapPhase>('awaiting-payment');
  const [refunding, setRefunding] = useState(false);
  const [refundedTxId, setRefundedTxId] = useState<string | null>(null);

  // Boltz fee schedule — fetched once on open so we can render min/max +
  // the expected service fee before the user commits to an amount.
  const [fees, setFees] = useState<boltzService.SwapFees | null>(null);

  // Track the bottom-sheet ref so we can present/dismiss imperatively.
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  // Session token guards stale callbacks when the user closes + reopens.
  const sessionRef = useRef(0);

  // A swap "flow" is in flight once we leave the amount step to create the
  // swap and until it's explicitly closed (creating the LN invoice / Boltz
  // swap, or a live swap awaiting/processing the on-chain payment). While
  // this is true the lockup-QR + status view MUST stay mounted — see
  // `handleSheetChange` / `enablePanDownToClose` below for why (#92).
  const swapInFlight = creating || swap !== null;
  // Mirror into a ref so the (stable) sheet-change callback always reads the
  // current value without being re-created on every render.
  const swapInFlightRef = useRef(false);
  swapInFlightRef.current = swapInFlight;

  // Reset / present the sheet when `visible` flips. Mirrors ReceiveSheet.
  useEffect(() => {
    if (visible) {
      sessionRef.current += 1;
      setStep('amount');
      setAmountSats(0);
      setCreating(false);
      setCreateError(null);
      setSwap(null);
      setPhase('awaiting-payment');
      setRefunding(false);
      setRefundedTxId(null);
      // Clear any prior session's fee schedule so a failed re-fetch falls
      // back to the fresh fallback constants instead of showing stale min/max.
      setFees(null);
      bottomSheetRef.current?.present();

      // Fetch fees in the background — non-blocking.
      const session = sessionRef.current;
      boltzService
        .getSubmarineSwapFees()
        .then((f) => {
          if (sessionRef.current === session) setFees(f);
        })
        .catch((e) => console.warn('[BoltzReceive] Fee fetch failed:', e));
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [visible]);

  // Android back: behave like the ReceiveSheet — closes the sheet.
  // When a swap is in flight, the close handler already shows the
  // "hands off, swap is in progress" guard via the user-side cancel UI;
  // back is just an alias for the user pressing Close.
  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [visible, onClose]);

  // Subscribe to swap status changes once the swap exists. Status drives
  // the visible phase + triggers post-success balance refresh.
  useEffect(() => {
    if (!swap) return;
    const session = sessionRef.current;
    const cleanup = { cancelled: false };

    boltzService
      .watchSubmarineSwapStatus(
        swap.id,
        (next, raw) => {
          if (cleanup.cancelled || sessionRef.current !== session) return;
          console.log(`[BoltzReceive] phase ${next} (raw=${raw})`);
          setPhase(next);
        },
        // External-sender swap — they may take a while to actually
        // broadcast. 24h is well within the Boltz timeout (currently
        // ~144 blocks ≈ 24h on mainnet) and matches the lockup window.
        24 * 60 * 60 * 1000,
      )
      .then(async (result) => {
        if (cleanup.cancelled || sessionRef.current !== session) return;
        if (result.phase === 'complete') {
          // Refresh the wallet balance so the user sees the credit
          // immediately when they bounce back into the app.
          if (walletId) {
            try {
              await refreshBalanceForWallet(walletId);
            } catch {}
          }
          await SecureStore.deleteItemAsync(`submarine_swap_${swap.id}`);
          await swapRecoveryService.unregisterPendingSubmarineSwap(swap.id);
          Toast.show({
            type: 'success',
            text1: t('boltzReceive.swapCompleteToastTitle'),
            text2: t('boltzReceive.swapCompleteToastBody', {
              amount: swap.expectedAmount.toLocaleString(),
              wallet: wallet ? walletLabel(wallet) : t('boltzReceive.yourWallet'),
            }),
            position: 'top',
            visibilityTime: 8000,
          });
        }
        // `failed` is handled by the Refund button in the render path —
        // we deliberately do *not* auto-broadcast here. The user might
        // be on the move and not have a stable Electrum connection;
        // they can hit Refund on their own time within the timeout
        // window, and `swapRecoveryService` is the safety net if they
        // close the app first.
      })
      .catch((e) => {
        if (cleanup.cancelled || sessionRef.current !== session) return;
        console.warn('[BoltzReceive] watchSubmarineSwapStatus errored:', e);
      });

    return () => {
      cleanup.cancelled = true;
    };
    // walletId/wallet/refreshBalance are read for the success branch —
    // re-running this effect on every wallet refresh would tear down + re-
    // open the WS subscription which is expensive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap]);

  /**
   * Find a fresh receive address from any of the user's on-chain wallets,
   * to use as the refund destination. We persist it alongside the swap
   * so `swapRecoveryService` can auto-broadcast on next launch if needed.
   * Returns null if the user has no on-chain wallet at all — the swap is
   * still allowed (Boltz support can recover funds in that case) but the
   * user gets a warning.
   */
  const pickRefundDestination = useCallback(async (): Promise<string | null> => {
    // Honour the user's chosen default first; fall back to the first
    // on-chain wallet if the default is unset / no longer exists.
    const defaultId = await getDefaultOnchainWalletId();
    const onchainWallets = wallets.filter((w) => w.walletType === 'onchain');
    const onchainWallet =
      onchainWallets.find((w) => w.id === defaultId) ?? onchainWallets[0] ?? null;
    if (!onchainWallet) return null;
    try {
      return await onchainService.getNextReceiveAddress(onchainWallet.id);
    } catch (e) {
      console.warn('[BoltzReceive] Failed to fetch refund address:', e);
      return null;
    }
  }, [wallets]);

  const handleConfirmAmount = useCallback(
    async (sats: number) => {
      if (!walletId || !wallet) return;
      setAmountSats(sats);
      setStep('qr');
      setCreating(true);
      setCreateError(null);

      try {
        // Step 1 — make an LN invoice on the destination NWC wallet for
        // exactly the requested amount. Boltz takes its fee from the
        // *on-chain* side (so the sender pays slightly more than `sats`),
        // but the LN invoice they pay is the bare amount.
        const invoice = await makeInvoiceForWallet(
          walletId,
          sats,
          'Boltz swap (on-chain → Lightning)',
        );

        // Step 2 — create the swap with Boltz.
        const created = await boltzService.createSubmarineSwapForward(invoice);

        // Step 3 — pre-fetch a refund destination from one of the user's
        // on-chain wallets so swapRecoveryService can auto-broadcast a
        // refund on next launch without prompting. If none exists, store
        // the swap *without* a destination — recovery will surface a
        // toast pointing the user back here instead of auto-refunding.
        const refundDestination = await pickRefundDestination();
        if (!refundDestination) {
          Toast.show({
            type: 'info',
            text1: t('boltzReceive.noOnchainToastTitle'),
            text2: t('boltzReceive.noOnchainToastBody'),
            position: 'top',
            visibilityTime: 9000,
          });
        }

        // Step 4 — persist *full* swap state under the same key prefix
        // TransferSheet uses (`submarine_swap_<id>`) so swapRecoveryService
        // picks it up. Includes refundDestination when available.
        await SecureStore.setItemAsync(
          `submarine_swap_${created.id}`,
          JSON.stringify({
            id: created.id,
            address: created.address,
            expectedAmount: created.expectedAmount,
            refundPrivateKey: created.refundPrivateKey,
            claimPublicKey: created.claimPublicKey,
            timeoutBlockHeight: created.timeoutBlockHeight,
            swapTree: created.swapTree,
            refundDestinationAddress: refundDestination ?? undefined,
            createdAt: Date.now(),
          }),
          // Device-only accessibility so the refundPrivateKey in this record
          // is never included in iCloud/Android backups or device migration —
          // matches TransferSheet's submarine-swap persistence.
          { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
        );
        await swapRecoveryService.registerPendingSubmarineSwap(created.id);

        setSwap(created);
        setPhase('awaiting-payment');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[BoltzReceive] Swap creation failed:', msg);
        setCreateError(msg);
      } finally {
        setCreating(false);
      }
    },
    [walletId, wallet, makeInvoiceForWallet, pickRefundDestination, t],
  );

  const handleRefund = useCallback(async () => {
    if (!swap) return;
    setRefunding(true);
    try {
      const lockup = await boltzService.getSubmarineSwapLockup(swap.id, swap.address);
      if (!lockup) {
        Toast.show({
          type: 'error',
          text1: t('boltzReceive.nothingToRefundTitle'),
          text2: t('boltzReceive.nothingToRefundBody'),
          position: 'top',
          visibilityTime: 8000,
        });
        return;
      }
      const dest = await pickRefundDestination();
      if (!dest) {
        Toast.show({
          type: 'error',
          text1: t('boltzReceive.addOnchainFirstTitle'),
          text2: t('boltzReceive.addOnchainFirstBody'),
          position: 'top',
          visibilityTime: 9000,
        });
        return;
      }
      const refundTxId = await boltzService.refundSwap(swap, lockup, dest);
      setRefundedTxId(refundTxId);
      Toast.show({
        type: 'success',
        text1: t('boltzReceive.refundBroadcastTitle'),
        text2: t('boltzReceive.refundBroadcastBody', {
          amount: lockup.amount.toLocaleString(),
          txid: refundTxId.slice(0, 10),
        }),
        position: 'top',
        visibilityTime: 10000,
      });
      await SecureStore.deleteItemAsync(`submarine_swap_${swap.id}`);
      await swapRecoveryService.unregisterPendingSubmarineSwap(swap.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[BoltzReceive] Refund failed:', msg);
      Toast.show({
        type: 'error',
        text1: t('boltzReceive.refundFailedTitle'),
        text2: msg,
        position: 'top',
        visibilityTime: 10000,
      });
    } finally {
      setRefunding(false);
    }
  }, [swap, pickRefundDestination, t]);

  const bip21Uri = swap ? boltzService.buildBoltzBip21Uri(swap.address, swap.expectedAmount) : '';
  const fee = swap ? swap.expectedAmount - amountSats : 0;

  const handleCopy = useCallback(async () => {
    if (bip21Uri) await Clipboard.setStringAsync(bip21Uri);
  }, [bip21Uri]);

  const handleShare = useCallback(async () => {
    if (!bip21Uri) return;
    try {
      await Share.share({ message: bip21Uri });
    } catch {}
  }, [bip21Uri]);

  const handleSheetChange = useCallback(
    (index: number) => {
      // Only a genuine, user-initiated collapse should close the sheet.
      // While a swap is being created or is awaiting/processing the on-chain
      // payment we must keep the lockup-QR + status view mounted: an
      // incidental gorhom collapse to -1 (e.g. the keyboard blurring as we
      // leave the amount step while the multi-second NWC/Boltz round-trip is
      // in flight, combined with the dynamic-content resize) would otherwise
      // tear the sheet down, unmount it (`if (!visible) return null`) and
      // lose the address the external sender still needs to pay. The user
      // leaves this view only via the explicit Cancel/Done/Close control,
      // which drives `onClose` directly (#92).
      if (index === -1 && !swapInFlightRef.current) onClose();
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

  // ── Phase-driven status copy ────────────────────────────────────────────
  // Single source of truth for what the swap-status block says under the
  // QR. Each branch mirrors a `SubmarineSwapPhase` from boltzService.
  let statusLabel = '';
  let statusVariant: 'default' | 'success' | 'error' = 'default';
  switch (phase) {
    case 'awaiting-payment':
      statusLabel = t('boltzReceive.statusAwaitingPayment');
      break;
    case 'detected':
      // `detected` covers both `transaction.mempool` and
      // `transaction.confirmed`, so the copy must stay accurate whether or
      // not the lockup has already confirmed — hence no "waiting for
      // confirmations" wording here.
      statusLabel = t('boltzReceive.statusDetected');
      break;
    case 'paying-invoice':
      statusLabel = t('boltzReceive.statusPayingInvoice');
      break;
    case 'complete':
      statusLabel = t('boltzReceive.statusComplete');
      statusVariant = 'success';
      break;
    case 'failed':
      statusLabel = t('boltzReceive.statusFailed');
      statusVariant = 'error';
      break;
    default:
      statusLabel = t('boltzReceive.statusUnknown');
  }

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      onChange={handleSheetChange}
      // Swipe-to-dismiss only while on the amount step (or a create error).
      // Once a swap flow is in flight the sheet must not be swipe- or
      // keyboard-collapsible — removing -1 as a reachable snap keeps the
      // lockup-QR + status view up until the user explicitly closes it (#92).
      enablePanDownToClose={!swapInFlight}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetView style={styles.content}>
        {step === 'amount' ? (
          // Reuse the same numpad screen as ReceiveSheet — gives us free
          // fiat/sats unit toggle and Boltz min/max enforcement.
          <AmountEntryScreen
            initialSats={amountSats}
            title={t('boltzReceive.amountTitle')}
            confirmLabel={t('boltzReceive.generateQr')}
            minSats={fees?.minAmount ?? boltzService.BOLTZ_MIN_SATS}
            maxSats={fees?.maxAmount ?? boltzService.BOLTZ_MAX_SATS}
            onBack={() => onClose()}
            onConfirm={(sats) => handleConfirmAmount(sats)}
          />
        ) : (
          <View style={styles.innerContent}>
            <Text style={styles.title}>{t('boltzReceive.title')}</Text>
            {wallet ? (
              <Text style={styles.walletLabel}>
                {t('boltzReceive.toWallet', { label: walletLabel(wallet) })}
              </Text>
            ) : null}

            {creating ? (
              <View style={styles.loadingBlock}>
                <ActivityIndicator size="large" color={colors.brandPink} />
                <Text style={styles.subtitle}>{t('boltzReceive.creating')}</Text>
              </View>
            ) : createError ? (
              <View style={styles.loadingBlock}>
                <Text style={styles.errorText}>{createError}</Text>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => setStep('amount')}
                  accessibilityLabel={t('boltzReceive.tryAgain')}
                  testID="boltz-receive-retry"
                >
                  <ChevronLeft size={18} color={colors.brandPink} />
                  <Text style={styles.actionButtonText}>{t('boltzReceive.back')}</Text>
                </TouchableOpacity>
              </View>
            ) : swap ? (
              <>
                <View style={styles.qrContainer}>
                  <QRCode value={bip21Uri} size={200} />
                </View>

                <View style={styles.amountRow}>
                  <Text style={styles.amountValue}>{swap.expectedAmount.toLocaleString()}</Text>
                  <Text style={styles.amountUnit}>SATS</Text>
                </View>
                {btcPrice ? (
                  <Text style={styles.amountFiat}>
                    {t('boltzReceive.approx', {
                      amount: formatFiat(satsToFiat(swap.expectedAmount, btcPrice), currency),
                    })}
                  </Text>
                ) : null}

                <Text style={styles.addressLabel}>
                  <Text style={styles.addressHighlight}>{swap.address.slice(0, 6)}</Text>
                  {swap.address.slice(6, -6)}
                  <Text style={styles.addressHighlight}>{swap.address.slice(-6)}</Text>
                </Text>

                <View style={styles.feeBreakdown}>
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>{t('boltzReceive.youReceiveLightning')}</Text>
                    <Text style={styles.feeValue}>
                      {t('boltzReceive.sats', { amount: amountSats.toLocaleString() })}
                    </Text>
                  </View>
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>{t('boltzReceive.senderPaysOnchain')}</Text>
                    <Text style={styles.feeValue}>
                      {t('boltzReceive.sats', { amount: swap.expectedAmount.toLocaleString() })}
                    </Text>
                  </View>
                  <View style={styles.feeRow}>
                    <Text style={styles.feeLabel}>{t('boltzReceive.boltzFee')}</Text>
                    <Text style={styles.feeValue}>
                      {t('boltzReceive.sats', { amount: fee.toLocaleString() })}
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.statusBlock,
                    statusVariant === 'success' && styles.statusBlockSuccess,
                    statusVariant === 'error' && styles.statusBlockError,
                  ]}
                  accessibilityLabel={t('boltzReceive.statusA11y', { status: statusLabel })}
                  testID="boltz-receive-status"
                >
                  {statusVariant === 'success' ? (
                    <Check size={18} color={colors.white} />
                  ) : statusVariant === 'error' ? (
                    <AlertTriangle size={18} color={colors.red} />
                  ) : (
                    <ActivityIndicator size="small" color={colors.brandPink} />
                  )}
                  <Text
                    style={[
                      styles.statusText,
                      statusVariant === 'success' && styles.statusTextSuccess,
                    ]}
                  >
                    {statusLabel}
                  </Text>
                </View>

                {swap.timeoutBlockHeight > 0 ? (
                  <Text style={styles.timeoutNote}>
                    {t('boltzReceive.timeoutNote', { height: swap.timeoutBlockHeight })}
                  </Text>
                ) : null}

                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.actionButton, !bip21Uri && styles.actionButtonDisabled]}
                    onPress={handleCopy}
                    disabled={!bip21Uri}
                    accessibilityLabel={t('boltzReceive.copyRequest')}
                    testID="boltz-receive-copy"
                  >
                    <Copy size={20} color={colors.brandPink} />
                    <Text style={styles.actionButtonText}>{t('boltzReceive.copy')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionButton, !bip21Uri && styles.actionButtonDisabled]}
                    onPress={handleShare}
                    disabled={!bip21Uri}
                    accessibilityLabel={t('boltzReceive.shareRequest')}
                    testID="boltz-receive-share"
                  >
                    <Text style={styles.actionButtonText}>{t('boltzReceive.share')}</Text>
                    <Share2 size={20} color={colors.brandPink} />
                  </TouchableOpacity>
                </View>

                {phase === 'failed' && !refundedTxId ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.refundButton,
                      pressed && { opacity: 0.7 },
                      refunding && styles.actionButtonDisabled,
                    ]}
                    onPress={handleRefund}
                    disabled={refunding}
                    accessibilityLabel={t('boltzReceive.refundA11y')}
                    testID="boltz-receive-refund"
                  >
                    {refunding ? (
                      <ActivityIndicator color={colors.brandPink} />
                    ) : (
                      <Text style={styles.refundButtonText}>{t('boltzReceive.refundButton')}</Text>
                    )}
                  </Pressable>
                ) : null}

                {refundedTxId ? (
                  <Text style={styles.timeoutNote}>
                    {t('boltzReceive.refundTxNote', { txid: refundedTxId.slice(0, 16) })}
                  </Text>
                ) : null}

                {/* Phase-aware close affordance. While a swap is in
                 *  progress (anything past awaiting-payment that's not
                 *  terminal), the language shifts to "hands off — swap
                 *  is in progress" so the user understands that closing
                 *  the sheet doesn't cancel anything; the background
                 *  task + swapRecoveryService will see it through. */}
                <TouchableOpacity
                  style={[styles.actionButton, { alignSelf: 'stretch' }]}
                  onPress={onClose}
                  accessibilityLabel={t('boltzReceive.close')}
                  testID="boltz-receive-close"
                >
                  <Text style={styles.actionButtonText}>
                    {phase === 'complete'
                      ? t('boltzReceive.done')
                      : phase === 'awaiting-payment'
                        ? t('boltzReceive.cancel')
                        : t('boltzReceive.closeSwapContinues')}
                  </Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
};

export default BoltzReceiveSheet;
