import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Linking,
  Platform,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Alert } from './BrandedAlert';
import { Toast } from './BrandedToast';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetTextInput,
  BottomSheetScrollView,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { useCameraPermissions } from 'expo-camera';
import { decode as bolt11Decode } from 'light-bolt11-decoder';
import { useWallet, useWalletLive } from '../contexts/WalletContext';
import { walletLabel } from '../types/wallet';
import { useNostr, useNostrContacts } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createSendSheetStyles } from '../styles/SendSheet.styles';
import { satsToFiatString } from '../services/fiatService';
import { getSendThreshold, shouldConfirmSend } from '../services/sendThresholdService';
import { ChevronUp, ChevronDown } from 'lucide-react-native';
import { fetchInvoice, LnurlPayParams } from '../services/lnurlService';
import {
  type DecodedInvoice,
  editAddressPrefill,
  isLightningAddress,
} from '../utils/sendSheetInput';
import { useSendSheetLnurl } from '../hooks/useSendSheetLnurl';
import { useSendSheetInput } from '../hooks/useSendSheetInput';
import * as boltzService from '../services/boltzService';
import * as onchainService from '../services/onchainService';
import { executeReverseSwap, isSwapSettlingError } from '../utils/reverseSwapSend';
import { npubEncode } from '../services/nostrService';
import { recordOutgoing as recordOutgoingCounterparty } from '../services/zapCounterpartyStorage';
import { isReplyTimeoutError, isConnectionError } from '../services/nwcService';
import * as swapRecoveryService from '../services/swapRecoveryService';
import PaymentProgressOverlay, { PaymentProgressState } from './PaymentProgressOverlay';
import { deferPostPaymentRefresh } from '../utils/deferPostPaymentRefresh';
import AmountEntryScreen from './AmountEntryScreen';
import SendAmountSection from './SendAmountSection';
import SendModeTabs, { type SendInputMode } from './SendModeTabs';
import SendNfcPane from './SendNfcPane';
import SendScanPane from './SendScanPane';
import { perfLog } from '../utils/perfLog';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialAddress?: string;
  initialPicture?: string;
  recipientPubkey?: string;
  recipientName?: string;
  // Optional Nostr event id to zap. When set, the 9734 zap request
  // carries an `e` tag scoping the zap to that note — the LNURL
  // server echoes it onto the 9735 receipt so per-note aggregation
  // (e.g. the find-log zaps-received pill in HuntPiggyDetail) picks
  // the zap up. Omit for plain zap-the-author flows.
  zapEventId?: string;
}

type InputMode = SendInputMode;
type Step = 'main' | 'amount';

let __sendSheetFirstVisibleLogged = false;
const SendSheet: React.FC<Props> = ({
  visible,
  onClose,
  initialAddress,
  initialPicture,
  recipientPubkey,
  recipientName,
  zapEventId,
}) => {
  if (visible && !__sendSheetFirstVisibleLogged) {
    __sendSheetFirstVisibleLogged = true;
    perfLog('SendSheet first render (visible=true)');
  }
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createSendSheetStyles(colors), [colors]);
  const {
    payInvoiceForWallet,
    refreshBalanceForWallet,
    fetchTransactionsForWallet,
    addPendingTransaction,
    activeWalletId,
    wallets,
    currency,
  } = useWallet();
  const { btcPrice } = useWalletLive();
  const { signZapRequest } = useNostr();
  const { contacts } = useNostrContacts();
  const [capturedWalletId, setCapturedWalletId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [invoiceData, setInvoiceData] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<DecodedInvoice | null>(null);
  const [sending, setSending] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>('scan');
  const [pasteText, setPasteText] = useState('');
  // Remount key for the paste BottomSheetTextInput. The field is intentionally
  // uncontrolled during typing (`defaultValue`, no `value` prop) so a slow
  // re-render of this large sheet can never cause RN to re-push a stale JS
  // snapshot over text the user has since kept typing natively — the exact
  // "duplicated stale prefix" / dropped-character race reported in #873 on
  // Android. Invariant: every *programmatic* value change goes through
  // applyPasteText (which bumps this key to remount with a fresh defaultValue);
  // onChangeText stays a bare setPasteText with NO key bump. Same pattern for
  // `memo` / memoKey below.
  const [pasteTextKey, setPasteTextKey] = useState(0);
  const [satsValue, setSatsValue] = useState(''); // amount input for lightning addresses (no invoice amount)
  const [step, setStep] = useState<Step>('main');
  const [lnurlParams, setLnurlParams] = useState<LnurlPayParams | null>(null);
  const [resolving, setResolving] = useState(false);
  const [memo, setMemo] = useState('');
  // See pasteTextKey above — same uncontrolled-remount pattern; programmatic
  // sets go through applyMemo, onChangeText stays a bare setMemo.
  const [memoKey, setMemoKey] = useState(0);
  const [activePubkey, setActivePubkey] = useState(recipientPubkey);
  const [activePicture, setActivePicture] = useState(initialPicture);
  const [isOnchainAddress, setIsOnchainAddress] = useState(false);
  const [isLnurl, setIsLnurl] = useState(false);
  const [boltzFees, setBoltzFees] = useState<boltzService.SwapFees | null>(null);
  const [loadingBoltzFees, setLoadingBoltzFees] = useState(false);
  const [onchainFeeEstimate, setOnchainFeeEstimate] = useState<string | null>(null);
  const [progressState, setProgressState] = useState<PaymentProgressState>('hidden');
  const [progressError, setProgressError] = useState<string | undefined>(undefined);
  // Whether the in-flight send is a Boltz reverse swap (Lightning → on-chain).
  // Drives the swap-aware "Boltz swap in progress" overlay copy vs the generic
  // "Still in flight" used for a plain Lightning send that's slow to confirm.
  const [inFlightIsSwap, setInFlightIsSwap] = useState(false);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  // Per-send AbortController so the Cancel button on PaymentProgressOverlay
  // can abort the NWC call's publish → reply-timeout → poll-for-preimage
  // chain without waiting ~5 minutes for it to give up on its own (#175).
  const paymentAbortRef = useRef<AbortController | null>(null);
  const dismissedInFlightRef = useRef(false);

  // Programmatic value changes for the uncontrolled paste/memo fields go through
  // these helpers, which bump the remount key so the input picks up the new
  // `defaultValue`. onChangeText must NOT use them — it stays a bare setter (no
  // key bump) so native typing is never fed back through React (#873).
  const applyPasteText = useCallback((v: string) => {
    setPasteText(v);
    setPasteTextKey((k) => k + 1);
  }, []);
  const applyMemo = useCallback((v: string) => {
    setMemo(v);
    setMemoKey((k) => k + 1);
  }, []);

  // No explicit snapPoints — gorhom v5's `enableDynamicSizing={true}`
  // default sizes the sheet to its content. Trailing action buttons
  // are rendered as a sticky footer below the scroll view (see the
  // fixed-footer structure in the render output below) so they stay
  // reachable even when the form content is tall enough to require
  // internal scrolling.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Amount-less bolt11 (`lnbc1…` with no amount prefix) — recipient lets
  // the sender pick the amount. NIP-47 `pay_invoice` accepts an optional
  // `amount` (msats) for these; route through AmountEntryScreen so the
  // user enters a value before we send.
  const isAmountlessBolt11 =
    scanned &&
    !isLightningAddress(invoiceData || '') &&
    !isOnchainAddress &&
    !isLnurl &&
    !!invoiceData &&
    decoded?.amountSats === null;
  const needsAmount =
    scanned &&
    (isLightningAddress(invoiceData || '') || isOnchainAddress || isAmountlessBolt11 || isLnurl);
  const currentSats = parseInt(satsValue) || 0;

  const selectedWalletId = capturedWalletId ?? activeWalletId;
  const selectedWallet = useMemo(
    () => wallets.find((w) => w.id === selectedWalletId) ?? null,
    [wallets, selectedWalletId],
  );
  const walletId = selectedWallet?.id ?? null;
  const walletBalance = selectedWallet?.balance ?? null;
  const walletName = selectedWallet ? walletLabel(selectedWallet) : t('sendSheet.walletFallback');

  useEffect(() => {
    if (visible) {
      setCapturedWalletId(activeWalletId);
      setDropdownOpen(false);
      setInvoiceData(null);
      setDecoded(null);
      setScanned(false);
      setSending(false);
      // Default to the paste tab unless the camera is actually usable — opening
      // on a scanner that can't start (permission unresolved/denied) is a
      // dead-end; the user can still switch to Scan, which prompts for access.
      setInputMode(initialAddress || !permission?.granted ? 'paste' : 'scan');
      applyPasteText(initialAddress || '');
      setSatsValue('');
      setStep('main');
      setLnurlParams(null);
      setResolving(false);
      setIsLnurl(false);
      applyMemo('');
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

  // Mirror latest pasteText / invoiceData into refs so handleEditAddress reads the submitted value without closing over it — keeping the callback (and onResolveError) reference-stable so useSendSheetLnurl's effects can depend on it without re-firing on keystrokes (Copilot #872). Synced in render so refs are current before any failure callback.
  const pasteTextRef = useRef(pasteText);
  pasteTextRef.current = pasteText;
  const invoiceDataRef = useRef(invoiceData);
  invoiceDataRef.current = invoiceData;
  // Freshest-value refs for the two uncontrolled inputs. Because the fields are
  // uncontrolled (`defaultValue`) the native text can momentarily run ahead of
  // React state under JS-thread load — the accepted tradeoff of the #873 fix. To
  // stop any *consumer* reading a stale value, onChangeText also writes the
  // native string into these refs synchronously (below), and the submit paths
  // (`handlePasteSubmit`, `handleSend`) read the ref, not the state. The
  // render-time assignments above/here keep the refs correct for *programmatic*
  // sets (applyPasteText/applyMemo), which don't fire onChangeText. Reading the
  // ref is therefore never staler than reading state — strictly a belt-and-
  // suspenders improvement that doesn't reintroduce the keystroke race.
  const memoRef = useRef(memo);
  memoRef.current = memo;

  // Fix-in-place recovery (#871): return to the paste/input step with the bad
  // value RETAINED (unlike handleReset, which blanks it) so a one-char typo
  // can be corrected without retyping the whole address. Unwinds the
  // resolved/scanned state but keeps pasteText / activePubkey. Reads the live
  // submitted value via refs so the callback identity stays stable (see above).
  const handleEditAddress = useCallback(() => {
    const prefill = editAddressPrefill(pasteTextRef.current, invoiceDataRef.current);
    setInvoiceData(null);
    setDecoded(null);
    setScanned(false);
    setLnurlParams(null);
    setResolving(false);
    setSatsValue('');
    setIsLnurl(false);
    setIsOnchainAddress(false);
    setStep('main');
    setInputMode('paste');
    applyPasteText(prefill);
  }, [applyPasteText]);

  // Resolution failed (typo / unreachable): toast the friendly error, then
  // hand the user straight back to the editable address (#871).
  const handleResolveError = useCallback(
    (title: string, body: string) => {
      Toast.show({ type: 'error', text1: title, text2: body });
      handleEditAddress();
    },
    [handleEditAddress],
  );

  // Resolve a scanned/pasted lightning address or raw LNURL into LNURL-pay
  // params (or report a withdraw claim code). Extracted to keep SendSheet
  // under the file-size cap — see useSendSheetLnurl.
  useSendSheetLnurl({
    scanned,
    invoiceData,
    isLnurl,
    recipientName,
    activePubkey,
    setLnurlParams,
    setDecoded,
    setResolving,
    setInvoiceData,
    setScanned,
    setIsLnurl,
    setSatsValue,
    onResolveError: handleResolveError,
  });

  // Input-intake: classify a scanned/pasted/typed target and drive decoded-send
  // state. Extracted to keep SendSheet under the file-size cap — see
  // useSendSheetInput (mirrors useSendSheetLnurl above).
  const { processInput, handleBarCodeScanned, handleNfcContent, handlePaste, handlePasteSubmit } =
    useSendSheetInput({
      scanned,
      pasteTextRef,
      activePubkey,
      recipientName,
      applyPasteText,
      setIsOnchainAddress,
      setIsLnurl,
      setInvoiceData,
      setDecoded,
      setScanned,
      setSatsValue,
      setLoadingBoltzFees,
      setBoltzFees,
      setOnchainFeeEstimate,
    });

  const handleSend = async () => {
    if (!invoiceData) return;
    // Read the memo from its ref, not state: the memo field is uncontrolled and
    // sits right next to the Send button, so a type-then-immediately-Send can
    // outrun the state flush. The ref is written synchronously in onChangeText.
    const submittedMemo = memoRef.current;
    // High-value confirmation gate (issue #82). Prompt the user before we
    // touch the abort controller / spinner / progress overlay so a Cancel
    // tap leaves the form exactly as it was. The amount used here matches
    // what the user is actually authorising — BOLT11's embedded amount
    // wins because that's the value `payInvoiceForWallet(...)` will pull
    // from the invoice; a leftover `satsValue` from a previous entry
    // would otherwise mis-state the confirmation. Only fall back to the
    // typed `currentSats` for zero-amount invoices, Lightning addresses,
    // and on-chain flows where there is no embedded amount to honour.
    const decodedAmount = decoded?.amountSats ?? 0;
    const authorisedAmount = decodedAmount > 0 ? decodedAmount : currentSats;
    const threshold = await getSendThreshold();
    if (shouldConfirmSend(authorisedAmount, threshold)) {
      const recipientLabel =
        recipientName ||
        (isLightningAddress(invoiceData) ? invoiceData : null) ||
        decoded?.description ||
        t('sendSheet.thisRecipient');
      const fiat =
        btcPrice !== null ? ` (${satsToFiatString(authorisedAmount, btcPrice, currency)})` : '';
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          t('sendSheet.confirmLargeSendTitle'),
          t('sendSheet.confirmLargeSendBody', {
            amount: authorisedAmount.toLocaleString(),
            fiat,
            recipient: recipientLabel,
          }),
          [
            { text: t('sendSheet.cancel'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('sendSheet.confirm'), onPress: () => resolve(true) },
          ],
        );
      });
      if (!confirmed) return;
    }
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
    setInFlightIsSwap(false);
    dismissedInFlightRef.current = false;
    try {
      if (isOnchainAddress) {
        if (currentSats <= 0) {
          Alert.alert(t('sendSheet.error'), t('sendSheet.enterAmount'));
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
          // Boltz reverse swap: Lightning → on-chain. The orchestration
          // (persist-before-pay for crash recovery, pay, lockup, claim) and
          // its #891 error contract live in reverseSwapSend — the catch
          // below maps SwapSettlingError / ReplyTimeoutError to the
          // swap-aware "Boltz swap in progress" overlay instead of "Payment
          // failed".
          setInFlightIsSwap(true);
          await executeReverseSwap({
            walletId: walletId!,
            destinationAddress: invoiceData,
            amountSats: currentSats,
            signal,
            payInvoice: payInvoiceForWallet,
            onReplyTimeout: handleReplyTimeout,
          });
        }
      } else if (isLightningAddress(invoiceData) || isLnurl) {
        if (!lnurlParams) {
          Alert.alert(t('sendSheet.error'), t('sendSheet.detailsNotResolved'));
          setSending(false);
          return;
        }
        if (currentSats <= 0) {
          Alert.alert(t('sendSheet.error'), t('sendSheet.enterAmount'));
          setSending(false);
          return;
        }
        if (currentSats < lnurlParams.minSats) {
          Alert.alert(
            t('sendSheet.error'),
            t('sendSheet.minAmount', { min: lnurlParams.minSats.toLocaleString() }),
          );
          setSending(false);
          return;
        }
        if (currentSats > lnurlParams.maxSats) {
          Alert.alert(
            t('sendSheet.error'),
            t('sendSheet.maxAmount', { max: lnurlParams.maxSats.toLocaleString() }),
          );
          setSending(false);
          return;
        }
        // Build invoice options (zap request for Nostr contacts, comment for all)
        const invoiceOptions: { nostr?: string; comment?: string } = {};

        // NIP-57 zap: sign a zap request if this is a Nostr contact and the server supports it
        if (activePubkey && lnurlParams.allowsNostr) {
          try {
            const zapRequestJson = await signZapRequest(
              activePubkey,
              currentSats,
              submittedMemo,
              zapEventId,
            );
            if (zapRequestJson) {
              invoiceOptions.nostr = zapRequestJson;
            } else if (__DEV__) {
              console.warn(
                `[Zap-send] signZapRequest returned empty for recipient=${activePubkey.slice(0, 8)} — payment will go through as a plain LN send (no kind-9735 receipt published on Nostr); local attribution still works because the counterparty is persisted below whenever activePubkey is set`,
              );
            }
          } catch (e) {
            // Don't let a signer failure block the payment — fall through to a plain LN send. The local-storage path below still records the counterparty when activePubkey is set, so the row will show the recipient even though there's no NIP-57 receipt on Nostr.
            console.warn(
              `[Zap-send] signZapRequest threw for recipient=${activePubkey.slice(0, 8)}:`,
              e,
            );
          }
        }

        // LNURL-pay comment (for non-zap or if server supports comments)
        if (submittedMemo && lnurlParams.commentAllowed > 0) {
          invoiceOptions.comment = submittedMemo.slice(0, lnurlParams.commentAllowed);
        }

        const bolt11 = await fetchInvoice(lnurlParams.callback, currentSats, invoiceOptions);
        await payInvoiceForWallet(walletId!, bolt11, {
          signal,
          onReplyTimeout: handleReplyTimeout,
        });

        if (__DEV__)
          console.log(
            `[Zap-send] paid ${currentSats} sats · allowsNostr=${!!lnurlParams.allowsNostr} activePubkey=${activePubkey ? activePubkey.slice(0, 8) + '…' : 'none'} hasZapRequest=${!!invoiceOptions.nostr}`,
          );

        // Persist the recipient locally whenever we know who we're paying — i.e. when activePubkey is set (Friends → Zap, ConversationScreen send, anything that arrived with a recipientPubkey prop). Decoupled from invoiceOptions.nostr so a signer failure or an LNURL server with allowsNostr=false doesn't strip the recipient's name from the transaction row. The Nostr-side path (zap receipt) is still emitted when invoiceOptions.nostr is set; this just guarantees local UI attribution even when the on-network NIP-57 receipt path is broken.
        if (activePubkey) {
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
                comment: submittedMemo,
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
                  description: submittedMemo || undefined,
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
        // Amount-bearing bolt11s pay as-is; amount-less bolt11s require
        // the user-entered sats threaded through as msats per NIP-47.
        if (isAmountlessBolt11 && currentSats <= 0) {
          Alert.alert(t('sendSheet.error'), t('sendSheet.enterAmount'));
          setSending(false);
          return;
        }
        // Guard against `currentSats * 1000` exceeding Number.MAX_SAFE_INTEGER
        // (~9e15) and silently losing precision when computing msats.
        // 9e12 sats is far above any practical Lightning payment
        // (~0.5 BTC HTLC ceiling = 5e7 sats) so this is purely a
        // defensive bound, not a UX limitation.
        const MAX_SAFE_SATS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
        if (isAmountlessBolt11 && currentSats > MAX_SAFE_SATS) {
          Alert.alert(t('sendSheet.error'), t('sendSheet.amountTooLarge'));
          setSending(false);
          return;
        }
        await payInvoiceForWallet(walletId!, invoiceData, {
          signal,
          onReplyTimeout: handleReplyTimeout,
          amountMsats: isAmountlessBolt11 ? currentSats * 1000 : undefined,
        });
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
        // Defer the heavy tx-list refresh (JSON.stringify + zap resolver)
        // off the interaction path so the success overlay's OK tap is
        // serviced immediately rather than blocked behind it (#859, #828).
        deferPostPaymentRefresh(async () => {
          try {
            await new Promise((r) => setTimeout(r, 600));
            await fetchTransactionsForWallet(capturedWalletId);
            await new Promise((r) => setTimeout(r, 1500));
            await fetchTransactionsForWallet(capturedWalletId);
          } catch {
            // Refresh failures are non-fatal — a manual pull-to-refresh
            // or the next natural refresh will pick the tx up.
          }
        });
      }
      if (signal.aborted) return;
      if (dismissedInFlightRef.current) return;
      setProgressState('success');
    } catch (error) {
      // User-initiated cancel via PaymentProgressOverlay's Cancel button:
      // the overlay has already been hidden by handleCancelPayment, so
      // just let the send complete silently without surfacing an error.
      if ((error as Error)?.name === 'AbortError' || signal.aborted) {
        return;
      }
      // Reply-timeout (ambiguous pay outcome) and a post-commit reverse-swap
      // settling error both mean "the money may have moved; it'll settle" —
      // surface "Still in flight", never "Payment failed" (#891).
      if (isReplyTimeoutError(error) || isSwapSettlingError(error)) {
        if (dismissedInFlightRef.current) return;
        setProgressError(undefined);
        setProgressState('in-flight-extended');
        return;
      }
      // A relay/transport connectivity failure (relay unreachable, publish
      // never completed) is an UNKNOWN outcome, not a confirmed failure —
      // the payment may have settled. Surface "Connection lost" with a
      // check-before-retry warning instead of "Payment failed" (#648).
      if (isConnectionError(error)) {
        if (dismissedInFlightRef.current) return;
        setProgressError(undefined);
        setProgressState('connection-lost');
        return;
      }
      if (dismissedInFlightRef.current) return;
      const message = error instanceof Error ? error.message : t('sendSheet.paymentFailed');
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

  const handleReplyTimeout = useCallback(() => {
    setProgressError(undefined);
    setProgressState((prev) => (prev === 'sending' ? 'in-flight-extended' : prev));
  }, []);

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

  // Track progressState in a ref so handleOverlayDismiss doesn't recapture
  // it on every state flip. Without this, the `sending` → `success`
  // transition rebuilds the callback, but Android's touch system can still
  // fire the previously-cached handler reference for an in-flight tap —
  // that stale closure reads `wasSuccess === false`, hides the overlay,
  // and never calls onClose. See #210.
  const progressStateRef = useRef(progressState);
  // Sync during render (not in a useEffect) so the ref is always current before any tap can fire. A useEffect runs after commit/paint, leaving a window where the OK button is visible but the ref still holds the previous value — which is exactly the race the second-round Copilot review on #210 flagged.
  progressStateRef.current = progressState;

  const handleOverlayDismiss = useCallback(() => {
    // Dismissing the overlay after a successful payment also closes the
    // parent sheet. On error we only dismiss the overlay so the user can
    // retry from the filled-in form.
    const prevState = progressStateRef.current;
    const shouldCloseParent = prevState === 'success' || prevState === 'in-flight-extended';
    if (prevState === 'in-flight-extended') {
      dismissedInFlightRef.current = true;
      // "Continue in background" on an in-flight swap: kick a recovery pass so
      // the claim is retried now rather than waiting for the next app launch.
      // Safe no-op (single-flight guarded) if the lockup isn't claimable yet —
      // pull-to-refresh / next foreground will retry.
      swapRecoveryService.recoverPendingSwaps().catch((e) => {
        console.warn('[Send] continue-in-background swap recovery failed:', e);
      });
    }
    setProgressState('hidden');
    setProgressError(undefined);
    // Defer the parent close so the overlay's hidden state renders first;
    // otherwise on a slow JS thread the parent sheet can tear down the
    // overlay component before the state update completes (#210).
    if (shouldCloseParent) setTimeout(() => onClose(), 0);
  }, [onClose]);

  const handleReset = () => {
    setInvoiceData(null);
    setDecoded(null);
    setScanned(false);
    applyPasteText('');
    setSatsValue('');
    setStep('main');
    applyMemo('');
    setLnurlParams(null);
    setResolving(false);
    setActivePubkey(undefined);
    setActivePicture(undefined);
    setIsOnchainAddress(false);
    setIsLnurl(false);
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

  // Open the sheet whenever it's asked to be visible. Do NOT gate on the
  // camera-permission hook: `useCameraPermissions()` can stay `null` (e.g. the
  // hook hasn't resolved, or returns null on some devices even when the OS
  // permission is granted), and gating here made the whole sheet render null so
  // `.present()` no-op'd and Send silently never opened. Only the scanner tab
  // needs the permission, and it handles a missing one with its own prompt.
  if (!visible) return null;

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
    : isAmountlessBolt11
      ? currentSats > 0
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
              title={t('sendSheet.enterAmountTitle')}
              minSats={amountMinSats}
              maxSats={amountMaxSats}
              confirmLabel={t('sendSheet.done')}
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
              <Text style={styles.title}>{t('sendSheet.send')}</Text>

              {/* Wallet selector */}
              {wallets.filter((w) => w.isConnected).length > 1 ? (
                <View style={styles.walletDropdownRow}>
                  <Text style={styles.walletLabel}>{t('sendSheet.from')}</Text>
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
                <Text style={styles.walletLabel}>
                  {t('sendSheet.fromWallet', { wallet: walletName })}
                </Text>
              )}

              {/* Mode tabs (icon toggles: QR scan / paste / NFC) */}
              {!scanned && <SendModeTabs mode={inputMode} onChange={setInputMode} />}

              {/* Scanner, paste input, or NFC reader */}
              {!scanned ? (
                inputMode === 'nfc' ? (
                  <SendNfcPane
                    active={visible && !scanned && inputMode === 'nfc'}
                    onContent={handleNfcContent}
                  />
                ) : inputMode === 'scan' ? (
                  <SendScanPane
                    permissionGranted={!!permission?.granted}
                    onRequestPermission={requestPermission}
                    onBarcodeScanned={handleBarCodeScanned}
                  />
                ) : (
                  <View style={styles.pasteSection}>
                    <BottomSheetTextInput
                      key={pasteTextKey}
                      style={styles.pasteInput}
                      placeholder={t('sendSheet.pastePlaceholder')}
                      placeholderTextColor={colors.textSupplementary}
                      defaultValue={pasteText}
                      onChangeText={(v) => {
                        // Keep the freshest native string in the ref synchronously
                        // (submit reads the ref, not state) while leaving the state
                        // setter a bare setPasteText with NO key bump — feeding
                        // native typing back through a remount is the #873 race.
                        pasteTextRef.current = v;
                        setPasteText(v);
                      }}
                      multiline
                      autoCapitalize="none"
                      autoCorrect={false}
                      accessibilityLabel={t('sendSheet.pasteInvoiceLabel')}
                      testID="send-paste-input"
                    />
                    <View style={styles.pasteButtonRow}>
                      <TouchableOpacity
                        style={styles.pasteButton}
                        onPress={handlePaste}
                        accessibilityLabel={t('sendSheet.pasteFromClipboard')}
                        testID="send-paste-clipboard"
                      >
                        <Text style={styles.pasteButtonText}>
                          {t('sendSheet.pasteFromClipboard')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.goButton, !pasteText.trim() && styles.goButtonDisabled]}
                        onPress={handlePasteSubmit}
                        disabled={!pasteText.trim()}
                        accessibilityLabel={t('sendSheet.goLabel')}
                        testID="send-paste-go"
                      >
                        <Text style={styles.goButtonText}>{t('sendSheet.go')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )
              ) : (
                /* Invoice/address detected - show details */
                <View style={styles.detailsCard}>
                  {activePicture && (
                    <ExpoImage
                      source={{ uri: activePicture }}
                      style={styles.recipientPicture}
                      cachePolicy="memory-disk"
                      recyclingKey={activePicture}
                      autoplay={false}
                    />
                  )}
                  {decoded?.description ? (
                    <Text style={styles.detailDescription}>{decoded.description}</Text>
                  ) : null}

                  <SendAmountSection
                    needsAmount={needsAmount}
                    resolving={resolving}
                    lnurlParams={lnurlParams}
                    isOnchainAddress={isOnchainAddress}
                    isAmountlessBolt11={isAmountlessBolt11}
                    currentSats={currentSats}
                    decodedAmountSats={decoded?.amountSats}
                    btcPrice={btcPrice}
                    currency={currency}
                    onEnterAmount={() => setStep('amount')}
                    styles={styles}
                    spinnerColor={colors.brandPink}
                  />

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

                  {/* Fee estimate for on-chain addresses. When the
                      payment goes through Boltz (anything that isn't
                      a *mnemonic* on-chain wallet) show the Boltz
                      logo so users know who is brokering the swap \u2014
                      same affordance as TransferSheet. The mnemonic
                      hot-wallet path bypasses Boltz and broadcasts
                      directly via BDK, so its logo is suppressed.
                      Watch-only / xpub on-chain wallets *do* still
                      hop through Boltz (they can't sign), so they
                      get the logo too. Mirrors the routing predicate
                      at SendSheet.tsx:411-415. */}
                  {isOnchainAddress && currentSats > 0 && (
                    <View style={styles.feeRow}>
                      {!(
                        selectedWallet?.walletType === 'onchain' &&
                        selectedWallet?.onchainImportMethod === 'mnemonic'
                      ) && (
                        <TouchableOpacity
                          onPress={() => Linking.openURL('https://boltz.exchange')}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          accessibilityLabel={t('sendSheet.poweredByBoltz')}
                        >
                          <ExpoImage
                            source={require('../../assets/images/boltz-logo.png')}
                            style={styles.boltzLogo}
                            contentFit="contain"
                          />
                        </TouchableOpacity>
                      )}
                      <Text style={styles.feeText}>
                        {selectedWallet?.walletType === 'onchain' &&
                        selectedWallet?.onchainImportMethod === 'mnemonic'
                          ? (onchainFeeEstimate ?? t('sendSheet.estimatingFee'))
                          : loadingBoltzFees
                            ? t('sendSheet.loadingFees')
                            : boltzFees
                              ? t('sendSheet.swapFee', {
                                  fee: boltzService
                                    .calculateSwapFee(currentSats, boltzFees)
                                    .toLocaleString(),
                                })
                              : t('sendSheet.feeUnavailable')}
                      </Text>
                    </View>
                  )}

                  {/* Memo / comment field for Lightning address payments */}
                  {needsAmount && (
                    <BottomSheetTextInput
                      key={memoKey}
                      style={styles.memoInput}
                      placeholder={
                        activePubkey
                          ? t('sendSheet.zapMessagePlaceholder')
                          : t('sendSheet.commentPlaceholder')
                      }
                      placeholderTextColor={colors.textSupplementary}
                      defaultValue={memo}
                      onChangeText={(v) => {
                        // Same as the paste field: mirror native text into memoRef
                        // synchronously so handleSend (which sits next to Send and
                        // can fire before state flushes) reads the freshest value.
                        memoRef.current = v;
                        setMemo(v);
                      }}
                      maxLength={lnurlParams?.commentAllowed || 150}
                      autoCorrect
                      testID="sendsheet-memo-input"
                      accessibilityLabel={t('sendSheet.zapMessageLabel')}
                    />
                  )}

                  {/* Edit-in-place: keep what was typed so a typo can be
                      fixed without retyping (#871). Only meaningful for
                      addresses / LNURL — a scanned bolt11 isn't hand-edited. */}
                  {(isLightningAddress(invoiceData || '') || isLnurl) && (
                    <TouchableOpacity
                      onPress={handleEditAddress}
                      accessibilityLabel={t('sendSheet.editAddress')}
                      testID="sendsheet-edit-address"
                    >
                      <Text style={styles.resetText}>{t('sendSheet.editAddress')}</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    onPress={handleReset}
                    accessibilityLabel={t('sendSheet.resetLabel')}
                    testID="sendsheet-reset"
                  >
                    <Text style={styles.resetText}>{t('sendSheet.resetText')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Balance */}
              {walletBalance !== null && btcPrice !== null && (
                <Text style={styles.balanceText}>
                  {t('sendSheet.balance', {
                    balance: walletBalance.toLocaleString(),
                    fiat: satsToFiatString(walletBalance, btcPrice, currency),
                  })}
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
                  <Text style={styles.cancelButtonText}>{t('sendSheet.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sendButton, (!canSend || sending) && styles.sendButtonDisabled]}
                  onPress={handleSend}
                  disabled={!canSend || sending}
                  accessibilityLabel={t('sendSheet.send')}
                  testID="sendsheet-send-button"
                >
                  {sending ? (
                    <ActivityIndicator color={colors.brandPink} />
                  ) : (
                    <Text style={styles.sendButtonText}>{t('sendSheet.send')}</Text>
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
        inFlightIsSwap={inFlightIsSwap}
      />
    </>
  );
};

export default SendSheet;
