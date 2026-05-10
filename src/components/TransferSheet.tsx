import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  BackHandler,
  Image,
  Keyboard,
  Linking,
  Platform,
} from 'react-native';
import { Alert } from './BrandedAlert';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import * as SecureStore from 'expo-secure-store';
import Toast from './BrandedToast';
import * as swapRecoveryService from '../services/swapRecoveryService';
import { useWallet } from '../contexts/WalletContext';
import { useNostr } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createTransferSheetStyles } from '../styles/TransferSheet.styles';
import { satsToFiatString } from '../services/fiatService';
import { getSendThreshold, shouldConfirmSend } from '../services/sendThresholdService';
import { WalletMetadata, WalletState } from '../types/wallet';
import * as onchainService from '../services/onchainService';
import * as boltzService from '../services/boltzService';
import * as lnurlService from '../services/lnurlService';
import { getWalletListForPubkey } from '../services/crossProfileWalletService';
import * as nip19 from 'nostr-tools/nip19';
import AmountEntryScreen from './AmountEntryScreen';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Step = 'main' | 'amount';

const TransferSheet: React.FC<Props> = ({ visible, onClose }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createTransferSheetStyles(colors), [colors]);
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
  const { identities, pubkey: activePubkey } = useNostr();

  const [sourceId, setSourceId] = useState<string | null>(null);
  const [destId, setDestId] = useState<string | null>(null);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [destDropdownOpen, setDestDropdownOpen] = useState(false);
  // Cross-profile transfers (#485): null means "current profile" (default
  // behaviour, identical to single-profile mode). When set to another
  // signed-in identity's pubkey, the destination dropdown rescopes to
  // that profile's wallet list (read read-only via
  // crossProfileWalletService — does NOT switch active identity).
  const [selectedProfilePubkey, setSelectedProfilePubkey] = useState<string | null>(null);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  // Holds the *other* profile's wallet metadata when
  // `selectedProfilePubkey` is set to a non-active identity. Loaded
  // lazily on profile-change. Stays as plain WalletMetadata (no live
  // balance / isConnected status) — those fields require the per-
  // identity NWC client which only runs for the active profile. The
  // dropdown renders without a balance suffix in that case.
  const [otherProfileWallets, setOtherProfileWallets] = useState<WalletMetadata[]>([]);
  const [satsValue, setSatsValue] = useState('');
  const [step, setStep] = useState<Step>('main');
  const [sending, setSending] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  // true once the foreground work is done and the background task has the
  // swap — the sheet becomes a "done, safe to close" confirmation state.
  const [handedOff, setHandedOff] = useState(false);
  // Set when the background reverse-swap task errors (usually an NWC relay
  // timeout leaving the LN payment state unknown). Drives the "Retry now"
  // button + the updated progress message in the progress view. Once the
  // retry succeeds we keep the error reference (so the spinner stays
  // suppressed in the post-retry state) and flip `recoveryAcked` to swap
  // the message + hide the Retry button.
  const [backgroundError, setBackgroundError] = useState<string | null>(null);
  const [retryingRecovery, setRetryingRecovery] = useState(false);
  const [recoveryAcked, setRecoveryAcked] = useState(false);
  // Synchronous re-entrancy guard for the Retry button. React's
  // setRetryingRecovery is async, so a fast double-tap can fire two
  // concurrent recoverPendingSwaps() calls before `disabled` flips. The
  // ref is checked + set synchronously inside the onPress closure.
  const retryInFlightRef = useRef(false);
  const [feeEstimate, setFeeEstimate] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<any>(null);
  // Monotonically bumped every time the sheet opens or closes. Detached async
  // work (background swap IIFE, Retry handler) captures the value at start and
  // skips component-state setters if it has changed — otherwise a late callback
  // from a previous transfer can leak error/progress state into a new one.
  // Bumped via `useMemo` keyed on `visible` so the increment lands
  // SYNCHRONOUSLY during render (before any IIFE this render kicks off
  // captures it), not in an effect that runs post-commit and could let a
  // late microtask from the previous session pass the stale-session check.
  const sessionRef = useRef(0);
  useMemo(() => {
    sessionRef.current += 1;
  }, [visible]);
  // No explicit snapPoints — content-height only, not user-draggable.

  const currentSats = parseInt(satsValue) || 0;

  // True iff the destination is owned by a different profile than the
  // active one. Cross-profile destinations are always WalletMetadata
  // (no live balance / isConnected) — payment resolution falls back to
  // on-chain receive address or LNURL-pay via the destination wallet's
  // stored `lightningAddress`.
  const isCrossProfile = selectedProfilePubkey !== null && selectedProfilePubkey !== activePubkey;

  const source = useMemo(() => wallets.find((w) => w.id === sourceId) ?? null, [wallets, sourceId]);
  // The dest object is either a full WalletState (current-profile,
  // includes isConnected + balance) or a bare WalletMetadata (other
  // profile). Downstream code reads only the metadata fields except
  // when checking `isConnected` for the LN-route decision — guarded
  // with explicit `'isConnected' in dest` checks.
  const dest = useMemo<WalletState | WalletMetadata | null>(() => {
    if (isCrossProfile) {
      return otherProfileWallets.find((w) => w.id === destId) ?? null;
    }
    return wallets.find((w) => w.id === destId) ?? null;
  }, [isCrossProfile, otherProfileWallets, wallets, destId]);

  // Available wallets for source: NWC wallets that are connected, or hot wallets (mnemonic)
  // Always scoped to the ACTIVE profile — signing always happens with
  // the active pubkey, so a cross-profile transfer is "active profile
  // sends → other profile receives".
  const sourceWallets = useMemo(
    () =>
      wallets.filter(
        (w) =>
          (w.walletType === 'nwc' && w.isConnected) ||
          (w.walletType === 'onchain' && w.onchainImportMethod === 'mnemonic'),
      ),
    [wallets],
  );

  // Destination dropdown contents.
  //  - Same profile: live WalletState list (existing behaviour).
  //  - Cross profile: read-only WalletMetadata from disk. We surface
  //    every wallet on the other profile EXCEPT watch-only on-chain
  //    + xpub-only (the destination has to be receivable). Practically
  //    that means: any NWC wallet (assumed receivable via the wallet's
  //    lightning address even when its NWC client isn't loaded here),
  //    plus any on-chain wallet (single-address xpub or mnemonic both
  //    can derive a receive address — SecureStore xpub key is keyed by
  //    walletId, not pubkey, so onchainService can read it directly).
  const destWallets = useMemo<(WalletState | WalletMetadata)[]>(() => {
    if (isCrossProfile) {
      return otherProfileWallets.filter(
        (w) => w.walletType === 'onchain' || w.walletType === 'nwc',
      );
    }
    return wallets.filter(
      (w) => w.id !== sourceId && (w.walletType === 'onchain' || w.isConnected),
    );
  }, [isCrossProfile, otherProfileWallets, wallets, sourceId]);

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

  // Cross-profile LN destinations need a `lightningAddress` to receive
  // (we resolve it via LNURL-pay). NWC-based cross-profile invoice
  // creation is deferred — would require running the destination
  // profile's NWC client out-of-band. See PR description for #485.
  const crossProfileLnNoAddress =
    isCrossProfile &&
    transferType !== null &&
    (transferType === 'ln-to-ln' || transferType === 'onchain-to-ln') &&
    dest !== null &&
    dest.walletType === 'nwc' &&
    !dest.lightningAddress;

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
      setBackgroundError(null);
      setRetryingRecovery(false);
      setRecoveryAcked(false);
      // NOTE: don't clear `retryInFlightRef` on visible-toggle. If the
      // user closes mid-retry + reopens fast enough that the IIFE is
      // still running, the in-flight ref must stay true so a second
      // tap is correctly rejected — the ref is cleared by the IIFE's
      // own finally block when its work actually completes.
      setFeeEstimate(null);
      setSourceDropdownOpen(false);
      setDestDropdownOpen(false);
      // Cross-profile state resets on every open — opening with a
      // stale "other profile" selection from a previous session would
      // be confusing. Default to current-profile (null) which matches
      // the legacy single-profile flow exactly.
      setSelectedProfilePubkey(null);
      setProfileDropdownOpen(false);
      setOtherProfileWallets([]);
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

  // Cross-profile (#485): load the OTHER profile's wallet list when the
  // user picks a non-active profile from the dropdown. Same-profile or
  // null selection clears the slot. The destination selection is
  // cleared whenever the profile changes — picking a wallet from
  // profile A and then switching to profile B should NOT carry the
  // (now invalid) wallet id over.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    if (selectedProfilePubkey === null || selectedProfilePubkey === activePubkey) {
      setOtherProfileWallets([]);
      return;
    }
    (async () => {
      try {
        const list = await getWalletListForPubkey(selectedProfilePubkey);
        if (!cancelled) setOtherProfileWallets(list);
      } catch (e) {
        if (__DEV__) console.warn('[Transfer] cross-profile wallet load failed:', e);
        if (!cancelled) setOtherProfileWallets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, selectedProfilePubkey, activePubkey]);

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

    // High-value confirmation gate (issue #82). Mirrors SendSheet's check
    // so a fat-fingered transfer above the user's threshold gets one
    // explicit "are you sure?" before we fire the swap / payment chain.
    // Run after fee/min/max validation so the prompt never appears for
    // an amount that would have been rejected anyway.
    const threshold = await getSendThreshold();
    if (shouldConfirmSend(currentSats, threshold)) {
      const fiat =
        btcPrice !== null ? ` (${satsToFiatString(currentSats, btcPrice, currency)})` : '';
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Confirm large transfer',
          `You're about to transfer ${currentSats.toLocaleString()} sats${fiat} from ${source.alias} to ${dest.alias}. Tap Confirm to proceed.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Confirm', onPress: () => resolve(true) },
          ],
        );
      });
      if (!confirmed) return;
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
    // Skip pending-tx for cross-profile destinations — that wallet
    // belongs to a different profile and isn't in the active wallets
    // array, so the call would silently no-op anyway.
    if (!isCrossProfile) {
      addPendingTransaction(destId, {
        type: 'incoming',
        amount: currentSats,
        description: swapLabel,
        created_at: now,
        settled_at: null,
      });
    }

    // Cross-profile invoice creation: we can't call
    // `makeInvoiceForWallet` against the OTHER profile's NWC client
    // (it isn't loaded in this provider's session). Fall back to the
    // destination wallet's `lightningAddress` via LNURL-pay, which
    // works for any wallet that publishes a lud16. The pre-flight
    // checks above (crossProfileLnNoAddress) prevent reaching this
    // path with a missing address, so by the time we land here the
    // value is guaranteed present.
    const fetchInvoiceForDest = async (destWallet: WalletState | WalletMetadata) => {
      if (isCrossProfile) {
        if (!destWallet.lightningAddress) {
          throw new Error(
            'Destination wallet has no lightning address. Set one on the destination wallet to receive cross-profile transfers.',
          );
        }
        const params = await lnurlService.resolveLightningAddress(destWallet.lightningAddress);
        if (currentSats < params.minSats || currentSats > params.maxSats) {
          throw new Error(
            `Destination accepts ${params.minSats.toLocaleString()}-${params.maxSats.toLocaleString()} sats.`,
          );
        }
        return lnurlService.fetchInvoice(params.callback, currentSats, {
          comment: 'Transfer',
        });
      }
      return makeInvoiceForWallet(destWallet.id, currentSats, 'Transfer');
    };

    try {
      if (transferType === 'ln-to-ln') {
        setProgressMsg('Creating invoice...');
        const invoice = await fetchInvoiceForDest(dest);
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
        const iifeSession = sessionRef.current;
        // Capture cross-profile flag into the IIFE closure — if the
        // user re-opens the sheet with a different profile selection
        // before the background task finishes, the dest is still the
        // ORIGINAL transfer's destination, which may be in another
        // profile's wallet list.
        const destIsCrossProfile = isCrossProfile;
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
              const refreshTasks: Promise<unknown>[] = [
                refreshBalanceForWallet(sourceId),
                fetchTransactionsForWallet(sourceId),
              ];
              if (!destIsCrossProfile) {
                refreshTasks.push(refreshBalanceForWallet(destId));
                refreshTasks.push(fetchTransactionsForWallet(destId));
              }
              await Promise.all(refreshTasks);
            } catch {}
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[Transfer] Background reverse swap failed:', msg);
            // Surface the error on the sheet itself — the previous version
            // only showed a toast and left the progress message stuck on
            // "Swap underway" forever. Users need an in-sheet signal so they
            // can act without having to catch a transient toast. Guarded by
            // the session token so a late failure from a previous transfer
            // cannot paint error state onto a new one.
            if (sessionRef.current === iifeSession) {
              // Coerce empty Error.message to a generic non-empty string
              // so the `backgroundError === null` check downstream behaves
              // consistently — Error.message can be empty in practice
              // (some SDK throws produce blank-message errors) and we need
              // a non-null sentinel to drive the spinner-suppression +
              // Retry-button render paths.
              setBackgroundError(msg || 'Background step failed');
              setProgressMsg(
                'Background step failed — the LN payment reply may have been dropped ' +
                  'by the relay. Your funds are safe; tap "Retry now" to re-check ' +
                  'and broadcast the claim. Otherwise the app will retry automatically on next launch.',
              );
            }
            Toast.show({
              type: 'error',
              text1: 'Swap in progress',
              text2:
                'Background step hit an error — tap "Retry now" in the sheet or relaunch the app. Funds are safe.',
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
        const invoice = await fetchInvoiceForDest(dest);
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
        // Same closure-capture pattern as the reverse-swap branch.
        const destIsCrossProfileSubmarine = isCrossProfile;
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
              const refreshTasks: Promise<unknown>[] = [
                refreshBalanceForWallet(sourceId),
                fetchTransactionsForWallet(sourceId),
              ];
              if (!destIsCrossProfileSubmarine) {
                refreshTasks.push(refreshBalanceForWallet(destId));
                refreshTasks.push(fetchTransactionsForWallet(destId));
              }
              await Promise.all(refreshTasks);
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

      // Refresh balances and transactions (non-critical). Cross-profile
      // destinations belong to a different profile's wallet list, so we
      // skip the dest refresh — `refreshBalanceForWallet`/`fetchTransactionsForWallet`
      // assume the walletId is in the active profile's wallets array
      // and would no-op or error otherwise.
      try {
        const tasks: Promise<unknown>[] = [
          refreshBalanceForWallet(sourceId),
          fetchTransactionsForWallet(sourceId),
        ];
        if (!isCrossProfile) {
          tasks.push(refreshBalanceForWallet(destId));
          tasks.push(fetchTransactionsForWallet(destId));
        }
        await Promise.all(tasks);
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
    sourceId &&
    destId &&
    currentSats > 0 &&
    transferType !== null &&
    !belowBoltzMin &&
    !crossProfileLnNoAddress;

  // Renders a label for either a live WalletState (current profile —
  // includes balance) or a bare WalletMetadata (other profile — no
  // live balance available without loading another NWC client).
  const renderWalletLabel = (w: WalletState | WalletMetadata) => {
    const balance = 'balance' in w ? w.balance : null;
    const balanceStr = balance !== null ? ` · ${balance.toLocaleString()} sats` : '';
    const typeStr = w.walletType === 'onchain' ? 'on-chain' : 'lightning';
    return `${w.alias} (${typeStr})${balanceStr}`;
  };

  // Sorted profile list for the Profile dropdown — active profile
  // first (so its row sits at the top, matching AccountSwitcherSheet),
  // then most-recently-used. Profile dropdown only renders when there
  // is more than one signed-in identity (single-profile users see the
  // legacy 2-dropdown layout unchanged).
  const profileOptions = [...identities].sort((a, b) => {
    if (a.pubkey === activePubkey) return -1;
    if (b.pubkey === activePubkey) return 1;
    return b.lastUsedAt - a.lastUsedAt;
  });

  const showProfileDropdown = profileOptions.length > 1;

  const renderProfileLabel = (pk: string): string => {
    if (pk === activePubkey) return 'This profile (default)';
    try {
      const npub = nip19.npubEncode(pk);
      return `${npub.slice(0, 14)}…${npub.slice(-6)}`;
    } catch {
      return `${pk.slice(0, 8)}…${pk.slice(-4)}`;
    }
  };

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      onChange={handleSheetChange}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      {step === 'amount' ? (
        <BottomSheetView style={styles.content}>
          <AmountEntryScreen
            initialSats={currentSats}
            title="Transfer amount"
            minSats={
              isBoltzTransfer
                ? (cachedBoltzFees?.minAmount ?? boltzService.BOLTZ_MIN_SATS)
                : undefined
            }
            maxSats={isBoltzTransfer ? cachedBoltzFees?.maxAmount : undefined}
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
          ref={scrollRef}
          style={styles.content}
          contentContainerStyle={{
            ...styles.innerContent,
            paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 40,
          }}
          keyboardShouldPersistTaps="handled"
        >
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
                  {/* Hide spinner whenever the background errored — even
                      after the retry succeeded. Re-enabling it would
                      misrepresent the "Recovery retried" state as still
                      running. Explicit `=== null` rather than `!x`
                      because Error.message can be empty string and we
                      want to suppress the spinner whenever the error
                      slot is set, regardless of message length. */}
                  {backgroundError === null && (
                    <ActivityIndicator size="small" color={colors.brandPink} />
                  )}
                  <Text style={styles.progressText}>{progressMsg}</Text>
                </View>
                {backgroundError !== null && !recoveryAcked && (
                  <TouchableOpacity
                    style={[styles.closeButton, retryingRecovery && styles.closeButtonDisabled]}
                    onPress={async () => {
                      // Synchronous re-entrancy guard. A fast double-tap
                      // can fire two onPress callbacks before React
                      // applies setRetryingRecovery(true) + the disabled
                      // prop — the ref check + set is atomic in JS, so
                      // the second tap returns immediately.
                      if (retryInFlightRef.current) return;
                      retryInFlightRef.current = true;
                      const retrySession = sessionRef.current;
                      setRetryingRecovery(true);
                      try {
                        await swapRecoveryService.recoverPendingSwaps();
                        Toast.show({
                          type: 'info',
                          text1: 'Retry kicked off',
                          text2: 'Any claimable swaps are being re-broadcast.',
                          position: 'top',
                          visibilityTime: 6000,
                        });
                        if (sessionRef.current === retrySession) {
                          // Keep `backgroundError` set so the spinner
                          // stays suppressed; flip `recoveryAcked` to
                          // swap the message + hide the Retry button.
                          setRecoveryAcked(true);
                          setProgressMsg(
                            'Recovery retried — check transaction history for the final status.',
                          );
                        }
                      } catch (err) {
                        const m = err instanceof Error ? err.message : String(err);
                        Toast.show({
                          type: 'error',
                          text1: 'Retry failed',
                          text2: m,
                          position: 'top',
                          visibilityTime: 8000,
                        });
                      } finally {
                        retryInFlightRef.current = false;
                        if (sessionRef.current === retrySession) {
                          setRetryingRecovery(false);
                        }
                      }
                    }}
                    disabled={retryingRecovery}
                    accessibilityLabel="Retry swap recovery"
                    testID="transfer-retry-now"
                  >
                    {retryingRecovery ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.closeButtonText}>Retry now</Text>
                    )}
                  </TouchableOpacity>
                )}
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

                {/* Profile selector — only when there are multiple
                    locally-configured profiles (#485). Default is the
                    active profile, which behaves identically to the
                    pre-multi-account flow. */}
                {showProfileDropdown && (
                  <>
                    <Text style={styles.sectionLabel}>Profile</Text>
                    <View style={[styles.dropdownWrapper, profileDropdownOpen && { zIndex: 15 }]}>
                      <TouchableOpacity
                        style={styles.dropdown}
                        onPress={() => {
                          setProfileDropdownOpen(!profileDropdownOpen);
                          setSourceDropdownOpen(false);
                          setDestDropdownOpen(false);
                        }}
                        testID="transfer-profile-dropdown"
                        accessibilityLabel="Destination profile"
                      >
                        <Text style={styles.dropdownText}>
                          {renderProfileLabel(selectedProfilePubkey ?? activePubkey ?? '')}
                        </Text>
                        <Text style={styles.dropdownArrow}>
                          {profileDropdownOpen ? '\u25B2' : '\u25BC'}
                        </Text>
                      </TouchableOpacity>
                      {profileDropdownOpen && (
                        <View style={styles.dropdownMenu}>
                          {profileOptions.map((id) => {
                            const isSelected =
                              (selectedProfilePubkey ?? activePubkey) === id.pubkey;
                            return (
                              <TouchableOpacity
                                key={id.pubkey}
                                testID={`transfer-profile-${id.pubkey}`}
                                style={[
                                  styles.dropdownItem,
                                  isSelected && styles.dropdownItemActive,
                                ]}
                                onPress={() => {
                                  // null = "current profile" so the
                                  // legacy code path (no cross-profile
                                  // load) fires when the user picks
                                  // the active identity explicitly.
                                  const next = id.pubkey === activePubkey ? null : id.pubkey;
                                  setSelectedProfilePubkey(next);
                                  setProfileDropdownOpen(false);
                                  // Clearing destId on profile change
                                  // — the previously-picked walletId
                                  // is from a different list and
                                  // would be visually stale.
                                  setDestId(null);
                                }}
                              >
                                <Text
                                  style={[
                                    styles.dropdownItemText,
                                    isSelected && styles.dropdownItemTextActive,
                                  ]}
                                >
                                  {renderProfileLabel(id.pubkey)}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  </>
                )}

                {/* Destination wallet selector */}
                <Text style={styles.sectionLabel}>To</Text>
                <View style={styles.dropdownWrapper}>
                  <TouchableOpacity
                    style={styles.dropdown}
                    onPress={() => {
                      setDestDropdownOpen(!destDropdownOpen);
                      setSourceDropdownOpen(false);
                      setProfileDropdownOpen(false);
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

                {/* Cross-profile LN without lightning address — see #485.
                    NWC-based invoice creation against another profile's
                    wallet isn't wired up yet (would require running that
                    profile's NWC client out-of-band). LNURL-pay via the
                    destination's lud16 is the only cross-profile LN path
                    today; this surfaces a clear remediation. */}
                {crossProfileLnNoAddress && (
                  <Text style={styles.warningText} testID="transfer-cross-profile-no-lud16">
                    Set a lightning address on the destination wallet to receive cross-profile
                    transfers. On-chain destinations work without one.
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
        </BottomSheetScrollView>
      )}
    </BottomSheetModal>
  );
};

export default TransferSheet;
