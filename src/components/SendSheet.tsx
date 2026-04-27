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
  Platform,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetTextInput,
  BottomSheetScrollView,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import { decode as bolt11Decode } from 'light-bolt11-decoder';
import { useWallet } from '../contexts/WalletContext';
import { walletLabel } from '../types/wallet';
import { useNostr } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createSendSheetStyles } from '../styles/SendSheet.styles';
import { satsToFiatString } from '../services/fiatService';
import { ChevronUp, ChevronDown } from 'lucide-react-native';
import { resolveLightningAddress, fetchInvoice, LnurlPayParams } from '../services/lnurlService';
import * as boltzService from '../services/boltzService';
import * as onchainService from '../services/onchainService';
import { npubEncode } from '../services/nostrService';
import { recordOutgoing as recordOutgoingCounterparty } from '../services/zapCounterpartyStorage';
import PaymentProgressOverlay, { PaymentProgressState } from './PaymentProgressOverlay';
import AmountEntryScreen from './AmountEntryScreen';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialAddress?: string;
  initialPicture?: string;
  recipientPubkey?: string;
  recipientName?: string;
}

type InputMode = 'scan' | 'paste';
type Step = 'main' | 'amount';

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
  return (
    lower.startsWith('lnbc') ||
    lower.startsWith('lntb') ||
    lower.startsWith('lnts') ||
    lower.startsWith('lnbs')
  );
}

const SendSheet: React.FC<Props> = ({
  visible,
  onClose,
  initialAddress,
  initialPicture,
  recipientPubkey,
  recipientName,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createSendSheetStyles(colors), [colors]);
  const {
    payInvoiceForWallet,
    refreshBalanceForWallet,
    fetchTransactionsForWallet,
    addPendingTransaction,
    activeWalletId,
    wallets,
    btcPrice,
    currency,
  } = useWallet();
  const { signZapRequest, contacts } = useNostr();
  const [capturedWalletId, setCapturedWalletId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [invoiceData, setInvoiceData] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<DecodedInvoice | null>(null);
  const [sending, setSending] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('scan');
  const [pasteText, setPasteText] = useState('');
  // Amount input for lightning addresses (no amount in invoice)
  const [satsValue, setSatsValue] = useState('');
  const [step, setStep] = useState<Step>('main');
  const [lnurlParams, setLnurlParams] = useState<LnurlPayParams | null>(null);
  const [resolving, setResolving] = useState(false);
  const [memo, setMemo] = useState('');
  const [activePubkey, setActivePubkey] = useState(recipientPubkey);
  const [activePicture, setActivePicture] = useState(initialPicture);
  const [isOnchainAddress, setIsOnchainAddress] = useState(false);
  const [boltzFees, setBoltzFees] = useState<boltzService.SwapFees | null>(null);
  const [loadingBoltzFees, setLoadingBoltzFees] = useState(false);
  const [onchainFeeEstimate, setOnchainFeeEstimate] = useState<string | null>(null);
  const [progressState, setProgressState] = useState<PaymentProgressState>('hidden');
  const [progressError, setProgressError] = useState<string | undefined>(undefined);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  // Per-send AbortController so the Cancel button on PaymentProgressOverlay
  // can abort the NWC call's publish → reply-timeout → poll-for-preimage
  // chain without waiting ~5 minutes for it to give up on its own (#175).
  const paymentAbortRef = useRef<AbortController | null>(null);

  // No explicit snapPoints — gorhom v5's `enableDynamicSizing={true}`
  // default sizes the sheet to its content. Trailing action buttons
  // are rendered as a sticky footer below the scroll view (see the
  // fixed-footer structure in the render output below) so they stay
  // reachable even when the form content is tall enough to require
  // internal scrolling.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const needsAmount = scanned && (isLightningAddress(invoiceData || '') || isOnchainAddress);
  const currentSats = parseInt(satsValue) || 0;

  const selectedWalletId = capturedWalletId ?? activeWalletId;
  const selectedWallet = useMemo(
    () => wallets.find((w) => w.id === selectedWalletId) ?? null,
    [wallets, selectedWalletId],
  );
  const walletId = selectedWallet?.id ?? null;
  const walletBalance = selectedWallet?.balance ?? null;
  const walletName = selectedWallet ? walletLabel(selectedWallet) : 'Wallet';

  useEffect(() => {
    if (visible) {
      setCapturedWalletId(activeWalletId);
      setDropdownOpen(false);
      setInvoiceData(null);
      setDecoded(null);
      setScanned(false);
      setSending(false);
      setInputMode(initialAddress ? 'paste' : 'scan');
      setPasteText(initialAddress || '');
      setSatsValue('');
      setStep('main');
      setLnurlParams(null);
      setResolving(false);
      setMemo('');
      // Sheet is kept mounted across opens, so useState(prop) init doesn't re-fire.
      // Re-apply recipient props or Friends-tab zap keeps stale activePubkey → no 9734.
      setActivePubkey(recipientPubkey);
      setActivePicture(initialPicture);
      bottomSheetRef.current?.present();
      if (initialAddress) {
        // Use setTimeout to process after state reset
        setTimeout(() => processInput(initialAddress), 0);
      }
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

  // Track keyboard height so the BottomSheetScrollView has enough bottom
  // padding to reach past the keyboard to the last field. Mirrors the
  // pattern in NostrLoginSheet / EditProfileSheet / TransferSheet —
  // rule 5 of the "Bottom sheet doesn't slide up when keyboard opens"
  // checklist in docs/TROUBLESHOOTING.adoc.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
          // When we're still pointed at a named friend (activePubkey +
          // recipientName both set), keep the friendly `Pay to <Name>`
          // label. After "Scan / paste different invoice" clears
          // activePubkey, let the LNURL server's metadata win again.
          if (!(activePubkey && recipientName)) {
            setDecoded((prev) => ({
              ...prev!,
              description: params.description || prev?.description || null,
            }));
          }
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
    return () => {
      cancelled = true;
    };
  }, [scanned, invoiceData, recipientName, activePubkey]);

  const processInput = (data: string) => {
    let input = data.trim();
    let bip21Amount: number | null = null;
    if (input.toLowerCase().startsWith('lightning:')) {
      input = input.substring(10);
    }
    // Parse BIP-21 bitcoin: URI — extract address and optional amount.
    // Avoid floating-point: convert the decimal string directly to sats via
    // integer math. `parseFloat("0.00012345") * 1e8` rounds unpredictably on
    // some values; parsing as digits preserves exact sat precision.
    if (input.toLowerCase().startsWith('bitcoin:')) {
      const withoutScheme = input.substring(8);
      const qIndex = withoutScheme.indexOf('?');
      if (qIndex >= 0) {
        const params = new URLSearchParams(withoutScheme.substring(qIndex + 1));
        const raw = (params.get('amount') ?? '').trim();
        if (/^\d+(\.\d{0,8})?$/.test(raw)) {
          const [wholePart, fracPart = ''] = raw.split('.');
          const fracPadded = (fracPart + '00000000').slice(0, 8);
          try {
            const sats = BigInt(wholePart) * 100_000_000n + BigInt(fracPadded);
            if (sats > 0n && sats <= 2_100_000_000_000_000n) {
              bip21Amount = Number(sats); // safe: well within Number.MAX_SAFE_INTEGER
            } else if (sats > 2_100_000_000_000_000n) {
              console.warn('BIP-21 amount exceeds Bitcoin max supply, ignoring');
            }
          } catch {
            console.warn('BIP-21 amount parse failed, ignoring:', raw);
          }
        } else if (raw) {
          console.warn('BIP-21 amount malformed, ignoring:', raw);
        }
        input = withoutScheme.substring(0, qIndex);
      } else {
        input = withoutScheme;
      }
    }

    if (isLightningAddress(input)) {
      setIsOnchainAddress(false);
      setInvoiceData(input);
      // Only use the caller-supplied friend name while we're still
      // pointed at that friend (activePubkey set). After "Scan / paste
      // different invoice" clears activePubkey, the next scanned address
      // may be a stranger — fall back to the raw input string.
      setDecoded({
        amountSats: null,
        description: `Pay to ${activePubkey && recipientName ? recipientName : input}`,
        expiry: null,
      });
      setScanned(true);
    } else if (boltzService.isBitcoinAddress(input)) {
      setIsOnchainAddress(true);
      setInvoiceData(input);
      setDecoded({ amountSats: null, description: `Send to on-chain address`, expiry: null });
      setScanned(true);
      // Pre-fill amount from BIP-21 URI if present (fiat view is derived
      // inside AmountEntryScreen from satsValue when the user opens it).
      if (bip21Amount) {
        setSatsValue(bip21Amount.toString());
      }
      // Fetch fees (Boltz for LN wallets, miner fee for hot wallets)
      setLoadingBoltzFees(true);
      boltzService
        .getSwapFees()
        .then((fees) => {
          setBoltzFees(fees);
        })
        .catch((err) => {
          console.warn('Failed to fetch Boltz fees:', err);
          setBoltzFees(null);
        })
        .finally(() => {
          setLoadingBoltzFees(false);
        });
      // Fetch on-chain fee estimate for hot wallets
      onchainService
        .estimateOnchainFee()
        .then((fees) => {
          setOnchainFeeEstimate(
            `~${fees.medium.toLocaleString()} sats miner fee \u00B7 ~10-60 min`,
          );
        })
        .catch((err) => {
          console.warn('Failed to estimate on-chain fee:', err);
        });
    } else if (isValidInvoice(input)) {
      setIsOnchainAddress(false);
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

  const handleSend = async () => {
    if (!invoiceData) return;
    // Abort any stale in-flight send (shouldn't happen in normal flow,
    // but guards against a cancel-then-resend race where the previous
    // controller is still referenced).
    paymentAbortRef.current?.abort();
    const abortController = new AbortController();
    paymentAbortRef.current = abortController;
    const signal = abortController.signal;
    setSending(true);
    setProgressError(undefined);
    setProgressState('sending');
    try {
      if (isOnchainAddress) {
        if (currentSats <= 0) {
          Alert.alert('Error', 'Please enter an amount.');
          setSending(false);
          return;
        }
        if (
          selectedWallet?.walletType === 'onchain' &&
          selectedWallet?.onchainImportMethod === 'mnemonic'
        ) {
          // Direct on-chain send from hot wallet
          await onchainService.sendTransaction(walletId!, invoiceData, currentSats);
        } else {
          // Boltz reverse swap: Lightning → on-chain
          const swap = await boltzService.createReverseSwap(invoiceData, currentSats);
          await payInvoiceForWallet(walletId!, swap.invoice, signal);
          const lockup = await boltzService.waitForLockup(swap.id, 120000);
          await boltzService.claimSwap(swap, lockup, invoiceData);
        }
      } else if (isLightningAddress(invoiceData)) {
        if (!lnurlParams) {
          Alert.alert('Error', 'Payment details not resolved yet. Please wait.');
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
        // Build invoice options (zap request for Nostr contacts, comment for all)
        const invoiceOptions: { nostr?: string; comment?: string } = {};

        // NIP-57 zap: sign a zap request if this is a Nostr contact and the server supports it
        if (activePubkey && lnurlParams.allowsNostr) {
          const zapRequestJson = await signZapRequest(activePubkey, currentSats, memo);
          if (zapRequestJson) {
            invoiceOptions.nostr = zapRequestJson;
          }
        }

        // LNURL-pay comment (for non-zap or if server supports comments)
        if (memo && lnurlParams.commentAllowed > 0) {
          invoiceOptions.comment = memo.slice(0, lnurlParams.commentAllowed);
        }

        const bolt11 = await fetchInvoice(lnurlParams.callback, currentSats, invoiceOptions);
        await payInvoiceForWallet(walletId!, bolt11, signal);

        if (__DEV__)
          console.log(
            `[Zap-send] paid ${currentSats} sats · allowsNostr=${!!lnurlParams.allowsNostr} activePubkey=${activePubkey ? activePubkey.slice(0, 8) + '…' : 'none'} hasZapRequest=${!!invoiceOptions.nostr}`,
          );

        // If this was a NIP-57 zap, persist the recipient we just paid so
        // the transaction list can render "Sent to [Name]" on refresh.
        // The public zap receipt identifies us as sender, not the person
        // we paid — we're the only party that actually knows who got it.
        if (invoiceOptions.nostr && activePubkey) {
          try {
            const decoded = bolt11Decode(bolt11);
            const hashSection = decoded.sections?.find(
              (s: { name: string }) => s.name === 'payment_hash',
            ) as { value?: string } | undefined;
            const paymentHash = hashSection?.value;
            if (paymentHash) {
              const contact = contacts.find((c) => c.pubkey === activePubkey);
              const p = contact?.profile ?? null;
              const counterparty = {
                pubkey: activePubkey,
                profile: {
                  npub: npubEncode(activePubkey),
                  name: p?.name ?? null,
                  displayName: p?.displayName ?? null,
                  picture: p?.picture ?? activePicture ?? null,
                  nip05: p?.nip05 ?? null,
                },
                comment: memo,
                anonymous: false,
              };
              await recordOutgoingCounterparty(paymentHash, counterparty);
              if (__DEV__)
                console.log(`[Zap-send] stored counterparty for ph=${paymentHash.slice(0, 12)}…`);
              // Optimistic insert: surface the outgoing zap in ConversationScreen
              // (and the transaction list) without waiting for LNbits to flush
              // the tx and the next resolver pass. The subsequent
              // fetchTransactionsForWallet refresh reconciles by paymentHash —
              // see WalletContext's counterpartyByHash loop which preserves
              // this attribution across refreshes.
              if (walletId) {
                const nowSec = Math.floor(Date.now() / 1000);
                // Convention throughout the app: amount is a POSITIVE magnitude
                // and `type` alone carries direction (see TransferSheet's
                // optimistic inserts, ConversationScreen's zapItems, and every
                // TransactionDetail consumer — all read Math.abs(tx.amount)).
                addPendingTransaction(walletId, {
                  type: 'outgoing',
                  amount: currentSats,
                  description: memo || undefined,
                  created_at: nowSec,
                  settled_at: nowSec,
                  paymentHash,
                  bolt11,
                  invoice: bolt11,
                  zapCounterparty: counterparty,
                  optimistic: true,
                });
              }
            }
          } catch (e) {
            if (__DEV__) console.warn('[Zap-send] store failed:', e);
          }
        }
      } else {
        await payInvoiceForWallet(walletId!, invoiceData, signal);
      }
      if (walletId) {
        // Refresh both balance and tx list so the user sees the send
        // appear without having to pull-to-refresh manually. The tx
        // list refresh also re-runs the zap-sender resolver, which
        // picks up the counterparty entry we just wrote.
        //
        // Small delay before the tx-list refresh: LNbits records the
        // outgoing payment asynchronously after pay_invoice returns, so
        // an immediate list_transactions call can miss the new tx and
        // the resolver then runs on a stale list (pending=0, silent).
        // We also refetch a second time in case the first call raced.
        await refreshBalanceForWallet(walletId);
        const capturedWalletId = walletId;
        (async () => {
          try {
            await new Promise((r) => setTimeout(r, 600));
            await fetchTransactionsForWallet(capturedWalletId);
            await new Promise((r) => setTimeout(r, 1500));
            await fetchTransactionsForWallet(capturedWalletId);
          } catch {
            // Refresh failures are non-fatal — a manual pull-to-refresh
            // or the next natural refresh will pick the tx up.
          }
        })();
      }
      if (signal.aborted) return;
      setProgressState('success');
    } catch (error) {
      // User-initiated cancel via PaymentProgressOverlay's Cancel button:
      // the overlay has already been hidden by handleCancelPayment, so
      // just let the send complete silently without surfacing an error.
      if ((error as Error)?.name === 'AbortError' || signal.aborted) {
        return;
      }
      const message = error instanceof Error ? error.message : 'Payment failed';
      setProgressError(message);
      setProgressState('error');
    } finally {
      // Only clear state if this invocation is still the active one.
      // A cancel-then-resend can leave the first (aborted) handleSend
      // resolving AFTER a new send has already set sending=true and
      // swapped in a new controller — clearing unconditionally here
      // would stomp that new send's state (re-enable Send button,
      // allow a double-tap). See Copilot review on #185.
      if (paymentAbortRef.current === abortController) {
        paymentAbortRef.current = null;
        setSending(false);
      }
    }
  };

  const handleCancelPayment = useCallback(() => {
    // Abort the NWC pay_invoice chain and hide the overlay so the user
    // can edit / retry / close from the filled-in SendSheet. Keep
    // `sending` true-ish in the background until the aborted promise
    // resolves in handleSend's finally, which will flip it off.
    paymentAbortRef.current?.abort();
    setProgressState('hidden');
    setProgressError(undefined);
    setSending(false);
  }, []);

  const handleOverlayDismiss = useCallback(() => {
    // Dismissing the overlay after a successful payment also closes the
    // parent sheet. On error we only dismiss the overlay so the user can
    // retry from the filled-in form.
    const wasSuccess = progressState === 'success';
    setProgressState('hidden');
    setProgressError(undefined);
    if (wasSuccess) onClose();
  }, [progressState, onClose]);

  const handleReset = () => {
    setInvoiceData(null);
    setDecoded(null);
    setScanned(false);
    setPasteText('');
    setSatsValue('');
    setStep('main');
    setMemo('');
    setLnurlParams(null);
    setResolving(false);
    setActivePubkey(undefined);
    setActivePicture(undefined);
    setIsOnchainAddress(false);
    setBoltzFees(null);
    setLoadingBoltzFees(false);
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

  if (!visible || !permission) return null;

  // On-chain sends from a hot on-chain wallet go direct; otherwise they
  // hop through a Boltz reverse swap whose server-reported min/max must
  // gate the amount step (not the LNURL range).
  const onchainViaBoltz =
    isOnchainAddress &&
    !(
      selectedWallet?.walletType === 'onchain' && selectedWallet?.onchainImportMethod === 'mnemonic'
    );
  const amountMinSats = onchainViaBoltz ? boltzFees?.minAmount : lnurlParams?.minSats;
  const amountMaxSats = onchainViaBoltz ? boltzFees?.maxAmount : lnurlParams?.maxSats;

  const canSend = isOnchainAddress
    ? currentSats > 0 && !loadingBoltzFees
    : needsAmount
      ? lnurlParams && currentSats > 0 && !resolving
      : !!invoiceData;

  return (
    <>
      <BottomSheetModal
        ref={bottomSheetRef}
        onChange={handleSheetChange}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
      >
        {/* AmountEntryScreen is a fixed-height component (card + button +
         *  4-row keypad) — wrap it in a plain BottomSheetView so the
         *  sheet's dynamic sizing measures the full intrinsic height.
         *  Wrapping inside a BottomSheetScrollView caused the sheet's
         *  height and the ScrollView's content height to become
         *  circular references, clipping the keypad's last row. */}
        {step === 'amount' ? (
          <BottomSheetView style={styles.content}>
            <AmountEntryScreen
              initialSats={currentSats}
              title="Enter amount"
              minSats={amountMinSats}
              maxSats={amountMaxSats}
              confirmLabel="Done"
              onBack={() => setStep('main')}
              onConfirm={(sats) => {
                setSatsValue(String(sats));
                setStep('main');
              }}
            />
          </BottomSheetView>
        ) : (
          <BottomSheetScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 40 },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.innerContent}>
              <Text style={styles.title}>Send</Text>

              {/* Wallet selector */}
              {wallets.filter((w) => w.isConnected).length > 1 ? (
                <View style={styles.walletDropdownRow}>
                  <Text style={styles.walletLabel}>From:</Text>
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
                          .filter((w) => w.isConnected)
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
                <Text style={styles.walletLabel}>From: {walletName}</Text>
              )}

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
                      Input
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
                        <Text style={styles.permissionText}>
                          Camera access needed to scan QR codes
                        </Text>
                        <TouchableOpacity
                          style={styles.permissionButton}
                          onPress={requestPermission}
                        >
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
                    <BottomSheetTextInput
                      style={styles.pasteInput}
                      placeholder="Paste invoice, lightning or bitcoin address..."
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
                  {activePicture && (
                    <Image source={{ uri: activePicture }} style={styles.recipientPicture} />
                  )}
                  {decoded?.description ? (
                    <Text style={styles.detailDescription}>{decoded.description}</Text>
                  ) : null}

                  {needsAmount ? (
                    /* Lightning address or on-chain: amount is entered on a dedicated step */
                    <View style={styles.amountSection}>
                      {resolving ? (
                        <ActivityIndicator size="small" color={colors.brandPink} />
                      ) : lnurlParams || isOnchainAddress ? (
                        <TouchableOpacity
                          style={styles.amountPickerRow}
                          onPress={() => setStep('amount')}
                          testID="send-amount-picker"
                          accessibilityLabel="Enter amount"
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
                      ) : null}
                      {lnurlParams ? (
                        <Text style={styles.rangeText}>
                          {lnurlParams.minSats.toLocaleString()} –{' '}
                          {lnurlParams.maxSats.toLocaleString()} sats
                        </Text>
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

                  {isOnchainAddress && invoiceData ? (
                    <Text style={styles.detailAddress}>
                      <Text style={styles.addressHighlight}>{invoiceData.slice(0, 6)}</Text>
                      {invoiceData.slice(6, -6)}
                      <Text style={styles.addressHighlight}>{invoiceData.slice(-6)}</Text>
                    </Text>
                  ) : isLightningAddress(invoiceData || '') ? (
                    <Text style={styles.detailAddress}>{invoiceData}</Text>
                  ) : (
                    <Text style={styles.invoiceText} numberOfLines={3}>
                      {invoiceData}
                    </Text>
                  )}

                  {/* Fee estimate for on-chain addresses */}
                  {isOnchainAddress && currentSats > 0 && (
                    <Text style={styles.feeText}>
                      {selectedWallet?.walletType === 'onchain' &&
                      selectedWallet?.onchainImportMethod === 'mnemonic'
                        ? (onchainFeeEstimate ?? 'Estimating fee...')
                        : loadingBoltzFees
                          ? 'Loading fees...'
                          : boltzFees
                            ? `Swap fee: ~${boltzService.calculateSwapFee(currentSats, boltzFees).toLocaleString()} sats \u00B7 ~10-60 min`
                            : 'Fee estimate unavailable'}
                    </Text>
                  )}

                  {/* Memo / comment field for Lightning address payments */}
                  {needsAmount && (
                    <BottomSheetTextInput
                      style={styles.memoInput}
                      placeholder={activePubkey ? 'Zap message (optional)' : 'Comment (optional)'}
                      placeholderTextColor={colors.textSupplementary}
                      value={memo}
                      onChangeText={setMemo}
                      maxLength={lnurlParams?.commentAllowed || 150}
                      autoCorrect
                      testID="sendsheet-memo-input"
                      accessibilityLabel="Zap message"
                    />
                  )}

                  <TouchableOpacity onPress={handleReset}>
                    <Text style={styles.resetText}>Scan / paste different invoice</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Balance */}
              {walletBalance !== null && btcPrice !== null && (
                <Text style={styles.balanceText}>
                  Balance: {walletBalance.toLocaleString()} sats (
                  {satsToFiatString(walletBalance, btcPrice, currency)})
                </Text>
              )}

              {/* Action buttons */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => {
                    handleReset();
                    onClose();
                  }}
                >
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
          </BottomSheetScrollView>
        )}
      </BottomSheetModal>
      <PaymentProgressOverlay
        state={progressState}
        direction="send"
        amountSats={currentSats || decoded?.amountSats || undefined}
        recipientName={recipientName}
        errorMessage={progressError}
        onDismiss={handleOverlayDismiss}
        onCancel={handleCancelPayment}
      />
    </>
  );
};

export default SendSheet;
