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
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from './BrandedToast';
import * as swapRecoveryService from '../services/swapRecoveryService';
import { promptSubmarineRefund } from '../utils/submarineRefund';
import { useWallet, useWalletLive } from '../contexts/WalletContext';
import { useNostr, OWN_PROFILE_CACHE_KEY_BASE } from '../contexts/NostrContext';
import { perAccountKey } from '../services/perAccountStorage';
import type { NostrProfile } from '../types/nostr';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
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
  const t = useTranslation();
  const styles = useMemo(() => createTransferSheetStyles(colors), [colors]);
  const {
    wallets,
    activeWalletId,
    currency,
    makeInvoiceForWallet,
    payInvoiceForWallet,
    refreshBalanceForWallet,
    fetchTransactionsForWallet,
    addPendingTransaction,
  } = useWallet();
  const { btcPrice } = useWalletLive();
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
  // Display-name cache for the Profile dropdown — same per-account
  // own-profile lookup AccountSwitcherSheet does. Without this the
  // dropdown would render raw npub prefixes for every other profile,
  // which is unhelpful when you've named those accounts (e.g. "Middle
  // Piggy"). Phase-1-only (no relay fan-out) — the data we need is
  // always on disk if the user has ever switched to that profile.
  const [profileNameById, setProfileNameById] = useState<Record<string, string>>({});
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
  //  - Same profile: live WalletState list (existing behaviour) —
  //    excludes the source wallet, and requires NWC wallets to be
  //    `isConnected` since we need the live client to make an
  //    invoice locally.
  //  - Cross profile: read-only WalletMetadata from disk. We surface
  //    every NWC wallet (their lud16 alone is enough to receive via
  //    LNURL-pay, no need for the destination's NWC client to be
  //    loaded here) and every on-chain wallet (xpub watch-only AND
  //    mnemonic both derive a receive address fine — the SecureStore
  //    xpub blob is keyed by walletId, not pubkey, so onchainService
  //    can read it for any local profile). The two SendSheet-style
  //    routes (BIP-21 paste, lud16 string) work identically here.
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
      setFeeEstimate(`~0 sats \u00B7 ${t('transferSheet.instantLightning')}`);
    } else if (transferType === 'ln-to-onchain' && cachedBoltzFees) {
      const fee = boltzService.calculateSwapFee(currentSats, cachedBoltzFees);
      setFeeEstimate(`~${fee.toLocaleString()} sats \u00B7 ${t('transferSheet.time10to60min')}`);
    } else if (transferType === 'onchain-to-ln' && cachedBoltzFees) {
      const fee = boltzService.calculateSwapFee(currentSats, cachedBoltzFees);
      setFeeEstimate(`~${fee.toLocaleString()} sats \u00B7 ${t('transferSheet.time10to60min')}`);
    } else if (transferType === 'onchain-to-onchain') {
      onchainService
        .estimateOnchainFee()
        .then((fees) => {
          setFeeEstimate(
            `~${fees.medium.toLocaleString()} sats \u00B7 ${t('transferSheet.time10to60min')}`,
          );
        })
        .catch(() => {
          setFeeEstimate(t('transferSheet.feeUnavailable'));
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

  // Phase-1 (cache-only) profile-name hydration for the Profile
  // dropdown — read each non-active identity's own-profile blob from
  // per-account AsyncStorage so the row reads "Middle Piggy" rather
  // than "npub1…tqp265". Same source AccountSwitcherSheet uses, no
  // relay fan-out (the kind-0 is always on disk after the user has
  // ever switched to that profile, and the relay fallback would slow
  // the sheet open and add UI flicker).
  useEffect(() => {
    if (!visible || identities.length <= 1) return;
    let cancelled = false;
    (async () => {
      const reads = await Promise.all(
        identities.map(async (id) => {
          // Hydrate every identity, including the active one — the
          // active row's display name is rendered as "<Name> · default"
          // by renderProfileLabel so the user can see *which* profile
          // they're currently transferring from. Per Copilot review.
          if (profileNameById[id.pubkey]) return null;
          try {
            const raw = await AsyncStorage.getItem(
              perAccountKey(OWN_PROFILE_CACHE_KEY_BASE, id.pubkey),
            );
            if (!raw) return null;
            const parsed = JSON.parse(raw) as NostrProfile;
            const name = parsed?.displayName || parsed?.name || null;
            if (!name) return null;
            return { pubkey: id.pubkey, name };
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const r of reads) if (r) next[r.pubkey] = r.name;
      if (Object.keys(next).length > 0) {
        setProfileNameById((prev) => ({ ...next, ...prev }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // profileNameById omitted — re-running on every resolve creates a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, identities, activePubkey]);

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
            t('transferSheet.useLightningTitle'),
            t('transferSheet.useLightningMessage', {
              alias: altLnWallet.alias,
              balance: altLnWallet.balance?.toLocaleString() ?? '0',
            }),
            [
              { text: t('transferSheet.cancel'), style: 'cancel', onPress: () => resolve(null) },
              { text: t('transferSheet.useLightning'), onPress: () => resolve(true) },
              { text: t('transferSheet.continueOnchain'), onPress: () => resolve(false) },
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
            t('transferSheet.useOnchainTitle'),
            t('transferSheet.useOnchainMessage', {
              alias: altOnchainWallet.alias,
              balance: altOnchainWallet.balance?.toLocaleString() ?? '0',
            }),
            [
              { text: t('transferSheet.cancel'), style: 'cancel', onPress: () => resolve(null) },
              { text: t('transferSheet.useOnchain'), onPress: () => resolve(true) },
              { text: t('transferSheet.continueLightning'), onPress: () => resolve(false) },
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
          t('transferSheet.amountTooLowTitle'),
          t('transferSheet.boltzMinMessage', {
            min: cachedBoltzFees.minAmount.toLocaleString(),
          }),
        );
        return;
      }
      if (currentSats > cachedBoltzFees.maxAmount) {
        Alert.alert(
          t('transferSheet.amountTooHighTitle'),
          t('transferSheet.boltzMaxMessage', {
            max: cachedBoltzFees.maxAmount.toLocaleString(),
          }),
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
          t('transferSheet.confirmLargeTitle'),
          t('transferSheet.confirmLargeMessage', {
            amount: currentSats.toLocaleString(),
            fiat,
            source: source.alias,
            dest: dest.alias,
          }),
          [
            { text: t('transferSheet.cancel'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('transferSheet.confirm'), onPress: () => resolve(true) },
          ],
        );
      });
      if (!confirmed) return;
    }

    setSending(true);
    setProgressMsg(t('transferSheet.preparingTransfer'));
    console.log(
      `[Transfer] Starting ${transferType}: ${currentSats} sats from ${source.alias} to ${dest.alias}`,
    );

    // Add pending transactions to both wallets immediately
    const now = Math.floor(Date.now() / 1000);
    const swapLabel =
      transferType === 'ln-to-onchain' || transferType === 'onchain-to-ln'
        ? t('transferSheet.boltzSwapInProgress')
        : t('transferSheet.transferInProgress');
    addPendingTransaction(sourceId, {
      type: 'outgoing',
      amount: currentSats,
      description: swapLabel,
      created_at: now,
      settled_at: null,
      // Flag so the tx-list merge keeps this row across a pull-to-refresh
      // until the real swap leg settles (#896).
      optimistic: true,
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
        optimistic: true,
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
          throw new Error(t('transferSheet.noLightningAddressError'));
        }
        const params = await lnurlService.resolveLightningAddress(destWallet.lightningAddress);
        if (currentSats < params.minSats || currentSats > params.maxSats) {
          throw new Error(
            t('transferSheet.destinationAcceptsRange', {
              min: params.minSats.toLocaleString(),
              max: params.maxSats.toLocaleString(),
            }),
          );
        }
        // Respect the destination LNURL's commentAllowed budget — some
        // servers reject the request when a comment is sent but
        // commentAllowed === 0. Truncate to the advertised limit when
        // they accept comments shorter than our default. Mirrors the
        // SendSheet LNURL-pay path.
        const opts: { comment?: string } = {};
        if (params.commentAllowed > 0) {
          opts.comment = 'Transfer'.slice(0, params.commentAllowed);
        }
        return lnurlService.fetchInvoice(params.callback, currentSats, opts);
      }
      return makeInvoiceForWallet(destWallet.id, currentSats, 'Transfer');
    };

    try {
      if (transferType === 'ln-to-ln') {
        setProgressMsg(t('transferSheet.creatingInvoice'));
        const invoice = await fetchInvoiceForDest(dest);
        setProgressMsg(t('transferSheet.sendingPayment'));
        await payInvoiceForWallet(sourceId, invoice);
      } else if (transferType === 'ln-to-onchain') {
        // Full Boltz reverse swap: LN → on-chain.
        // Foreground: create swap, persist, dispatch LN payment, dismiss sheet.
        // Background: wait for on-chain lockup, build & broadcast claim tx.
        setProgressMsg(t('transferSheet.creatingBoltzSwap'));
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
        // Stage tracker so the catch handler can report WHICH step of
        // the reverse-swap pipeline failed, not just the bare error
        // message. Surfaces in `console.warn` so it survives the
        // production `transform-remove-console` strip — critical for
        // diagnosing field reports like "swap failed with 'unknown
        // Error'" without having to read the user's screenshot for
        // which sheet stage they got stuck at.
        let stage: 'payInvoice' | 'waitForLockup' | 'claimSwap' | 'cleanup' | 'refresh' =
          'payInvoice';
        (async () => {
          try {
            await payInvoiceForWallet(sourceId, swap.invoice);
            Toast.show({
              type: 'info',
              text1: t('transferSheet.lightningPaymentSent'),
              text2: t('transferSheet.waitingForBoltzLock', {
                amount: amount.toLocaleString(),
              }),
              position: 'top',
              visibilityTime: 5000,
            });
            stage = 'waitForLockup';
            const lockup = await boltzService.waitForLockup(swap.id, 900000);
            stage = 'claimSwap';
            const claimed = await boltzService.claimSwap(swap, lockup, address);
            Toast.show({
              type: 'success',
              text1: t('transferSheet.swapComplete'),
              text2: t('transferSheet.swapCompleteOnchain', {
                amount: amount.toLocaleString(),
                txid: claimed.slice(0, 10),
              }),
              position: 'top',
              visibilityTime: 10000,
            });
            stage = 'cleanup';
            await SecureStore.deleteItemAsync(`boltz_swap_${swap.id}`);
            await swapRecoveryService.unregisterPendingSwap(swap.id);
            // Record the claim so TransactionList can badge the row 'done'
            // and the detail sheet can surface the claim txid.
            await swapRecoveryService.recordClaimedFromPreimage(swap.preimage, claimed);
            stage = 'refresh';
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
            console.warn(
              `[Transfer] reverse swap ${swap.id.slice(0, 8)} failed at stage="${stage}": ${msg || '(no message)'}`,
            );
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
              setBackgroundError(msg || t('transferSheet.backgroundStepFailed'));
              setProgressMsg(t('transferSheet.backgroundStepFailedMessage'));
            }
            Toast.show({
              type: 'error',
              text1: t('transferSheet.swapInProgress'),
              text2: t('transferSheet.swapInProgressToast'),
              position: 'top',
              visibilityTime: 10000,
            });
          }
        })();

        // Show a terminal "underway" state with the Close button active so
        // the user can dismiss when they're ready. The background task runs
        // independently and will surface completion via toasts.
        setProgressMsg(t('transferSheet.boltzUnderwayReverse'));
        didHandOff = true;
        setHandedOff(true);
        return;
      } else if (transferType === 'onchain-to-ln') {
        setProgressMsg(t('transferSheet.creatingBoltzSwap'));
        const invoice = await fetchInvoiceForDest(dest);
        const swap = await boltzService.createSubmarineSwapForward(invoice);

        // Persist swap state for crash recovery + refund (includes all keys
        // and scripts). `sourceWalletId` lets the recovery pass derive a
        // refund address if the app is killed before the swap settles.
        // Registered in the index too so recoverPendingSwaps actually finds
        // it (previously this record was written but never read).
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
            sourceWalletId: sourceId,
            createdAt: Date.now(),
          }),
          { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
        );
        await swapRecoveryService.registerPendingSubmarineSwap(swap.id);

        // Foreground: broadcast the on-chain tx (the user's action).
        // Background: wait for Boltz to pay the LN invoice, handle refund path.
        setProgressMsg(t('transferSheet.broadcastingOnchain'));
        console.log(
          `[Transfer] Sending ${swap.expectedAmount} sats on-chain to Boltz address ${swap.address}`,
        );
        const lockupTxId = await onchainService.sendTransaction(
          sourceId,
          swap.address,
          swap.expectedAmount,
        );
        // Tag both legs so the settled on-chain lockup + LN receive badge as a
        // Boltz swap rather than generic Sent/Received (#895).
        await swapRecoveryService.recordSubmarineSwapLegs(lockupTxId, invoice, swap.id);
        const submarineAmount = swap.expectedAmount;
        // Same closure-capture pattern as the reverse-swap branch.
        const destIsCrossProfileSubmarine = isCrossProfile;
        (async () => {
          try {
            await boltzService.waitForSubmarineSwapComplete(swap.id, 900000);
            Toast.show({
              type: 'success',
              text1: t('transferSheet.swapComplete'),
              text2: t('transferSheet.swapCompleteLightning', {
                amount: submarineAmount.toLocaleString(),
              }),
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
            // #894: ONLY an explicit Boltz FAIL_STATUS is terminal → refund path.
            // Timeouts AND transient/network errors (e.g. "Boltz status check
            // failed: 500", fetch failures) are ambiguous — the swap may still
            // settle — so show "still settling", never a false "Swap Failed".
            if (boltzService.isExplicitSwapFailure(swapError)) {
              await promptSubmarineRefund(swap, sourceId, msg);
            } else {
              Toast.show({
                type: 'info',
                text1: t('transferSheet.swapStillSettling'),
                text2: t('transferSheet.swapStillSettlingToast'),
                position: 'top',
                visibilityTime: 12000,
              });
            }
          }
        })();

        // Terminal "underway" state — user closes when ready. Background
        // task will toast on completion/failure.
        setProgressMsg(t('transferSheet.boltzUnderwayForward'));
        didHandOff = true;
        setHandedOff(true);
        return;
      } else if (transferType === 'onchain-to-onchain') {
        setProgressMsg(t('transferSheet.sendingOnchain'));
        const address = await onchainService.getNextReceiveAddress(destId);
        await onchainService.sendTransaction(sourceId, address, currentSats);
      }

      setProgressMsg(t('transferSheet.refreshingWallets'));

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
          ? t('transferSheet.settleMsgOnchain', { amount: currentSats.toLocaleString() })
          : t('transferSheet.settleMsgTransferred', { amount: currentSats.toLocaleString() });

      Alert.alert(t('transferSheet.transferComplete'), settleMsg, [
        { text: t('transferSheet.ok'), onPress: onClose },
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('transferSheet.transferFailedFallback');
      // "Cannot read property 'reload' of undefined" comes from
      // react-native's HMRClient when Metro drops the dev-client
      // connection. It is NOT a transfer failure — nothing was signed
      // or broadcast. Surface it as a dev-mode hiccup with a clear
      // retry hint instead of a scary "Transfer Failed" alert.
      if (/reload.*of undefined|DevSettings/i.test(message)) {
        Alert.alert(t('transferSheet.devReloadTitle'), t('transferSheet.devReloadMessage'), [
          { text: t('transferSheet.ok') },
        ]);
      } else {
        Alert.alert(t('transferSheet.transferFailedTitle'), message);
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
    const typeStr =
      w.walletType === 'onchain'
        ? t('transferSheet.walletTypeOnchain')
        : t('transferSheet.walletTypeLightning');
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
    const cachedName = profileNameById[pk];
    if (pk === activePubkey) {
      // Mark the active profile so the user knows which row signs
      // the transfer; surface its actual name when we have it
      // cached so the dropdown reads e.g. "Big Piggy · default"
      // instead of an opaque "This profile (default)" that hides
      // who that is.
      return cachedName
        ? t('transferSheet.profileDefaultNamed', { name: cachedName })
        : t('transferSheet.thisProfileDefault');
    }
    if (cachedName) return cachedName;
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
            title={t('transferSheet.transferAmountTitle')}
            minSats={
              isBoltzTransfer
                ? (cachedBoltzFees?.minAmount ?? boltzService.BOLTZ_MIN_SATS)
                : undefined
            }
            maxSats={isBoltzTransfer ? cachedBoltzFees?.maxAmount : undefined}
            confirmLabel={t('transferSheet.done')}
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
            <Text style={styles.title}>{t('transferSheet.transferTitle')}</Text>

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
                    {t('transferSheet.feeColon')} {feeEstimate.split('\u00B7')[0].trim()}
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
                          text1: t('transferSheet.retryKickedOff'),
                          text2: t('transferSheet.retryKickedOffToast'),
                          position: 'top',
                          visibilityTime: 6000,
                        });
                        if (sessionRef.current === retrySession) {
                          // Keep `backgroundError` set so the spinner
                          // stays suppressed; flip `recoveryAcked` to
                          // swap the message + hide the Retry button.
                          setRecoveryAcked(true);
                          setProgressMsg(t('transferSheet.recoveryRetried'));
                        }
                      } catch (err) {
                        const m = err instanceof Error ? err.message : String(err);
                        Toast.show({
                          type: 'error',
                          text1: t('transferSheet.retryFailed'),
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
                    accessibilityLabel={t('transferSheet.retrySwapRecovery')}
                    testID="transfer-retry-now"
                  >
                    {retryingRecovery ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.closeButtonText}>{t('transferSheet.retryNow')}</Text>
                    )}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  accessibilityLabel={t('transferSheet.close')}
                >
                  <Text style={styles.closeButtonText}>{t('transferSheet.close')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.sectionLabel}>{t('transferSheet.from')}</Text>
                <View style={[styles.dropdownWrapper, sourceDropdownOpen && { zIndex: 20 }]}>
                  <TouchableOpacity
                    style={styles.dropdown}
                    onPress={() => {
                      setSourceDropdownOpen(!sourceDropdownOpen);
                      setDestDropdownOpen(false);
                    }}
                    testID="transfer-source-dropdown"
                    accessibilityLabel={t('transferSheet.sourceWallet')}
                  >
                    <Text style={styles.dropdownText}>
                      {source ? renderWalletLabel(source) : t('transferSheet.selectWallet')}
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
                        <Text style={styles.dropdownEmpty}>
                          {t('transferSheet.noWalletsCanSend')}
                        </Text>
                      )}
                    </View>
                  )}
                </View>

                {/* Destination block. With multiple profiles signed in
                    we render `To` as a header followed by both the
                    profile and the wallet dropdown — semantically
                    "pick *who*, then pick *which of their wallets*"
                    (#485). With a single profile, the profile dropdown
                    collapses out and the layout matches the pre-#485
                    flow exactly. */}
                <Text style={styles.sectionLabel}>{t('transferSheet.to')}</Text>
                {showProfileDropdown && (
                  <View style={[styles.dropdownWrapper, profileDropdownOpen && { zIndex: 15 }]}>
                    <TouchableOpacity
                      style={styles.dropdown}
                      onPress={() => {
                        setProfileDropdownOpen(!profileDropdownOpen);
                        setSourceDropdownOpen(false);
                        setDestDropdownOpen(false);
                      }}
                      testID="transfer-profile-dropdown"
                      accessibilityLabel={t('transferSheet.destinationProfile')}
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
                          const isSelected = (selectedProfilePubkey ?? activePubkey) === id.pubkey;
                          return (
                            <TouchableOpacity
                              key={id.pubkey}
                              testID={`transfer-profile-${id.pubkey}`}
                              style={[styles.dropdownItem, isSelected && styles.dropdownItemActive]}
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
                )}

                {/* Destination wallet selector — sits under the same
                    `To` header above (and beneath the profile dropdown
                    when one is shown). */}
                <View style={styles.dropdownWrapper}>
                  <TouchableOpacity
                    style={styles.dropdown}
                    onPress={() => {
                      setDestDropdownOpen(!destDropdownOpen);
                      setSourceDropdownOpen(false);
                      setProfileDropdownOpen(false);
                    }}
                    testID="transfer-dest-dropdown"
                    accessibilityLabel={t('transferSheet.destinationWallet')}
                  >
                    <Text style={styles.dropdownText}>
                      {dest ? renderWalletLabel(dest) : t('transferSheet.selectWallet')}
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
                <Text style={styles.sectionLabel}>{t('transferSheet.amount')}</Text>
                <TouchableOpacity
                  style={styles.amountPickerRow}
                  onPress={() => setStep('amount')}
                  testID="transfer-amount-picker"
                  accessibilityLabel={t('transferSheet.enterTransferAmount')}
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
                    <Text style={styles.amountPickerPlaceholder}>
                      {t('transferSheet.enterAmount')}
                    </Text>
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
                        {t('transferSheet.estimatedFee')} {feeEstimate.split('\u00B7')[0].trim()}
                      </Text>
                      {feeEstimate.includes('\u00B7') && (
                        <Text style={styles.feeText}>
                          {t('transferSheet.estimatedTime')} {feeEstimate.split('\u00B7')[1].trim()}
                        </Text>
                      )}
                    </View>
                  </View>
                )}

                {/* Boltz minimum amount warning */}
                {belowBoltzMin && (
                  <Text style={styles.warningText}>
                    {t('transferSheet.boltzMinWarning', {
                      min: boltzService.BOLTZ_MIN_SATS.toLocaleString(),
                    })}
                  </Text>
                )}

                {/* Watch-only warning */}
                {source?.walletType === 'onchain' && source?.onchainImportMethod !== 'mnemonic' && (
                  <Text style={styles.warningText}>{t('transferSheet.watchOnlyWarning')}</Text>
                )}

                {/* Cross-profile LN without lightning address — see #485.
                    NWC-based invoice creation against another profile's
                    wallet isn't wired up yet (would require running that
                    profile's NWC client out-of-band). LNURL-pay via the
                    destination's lud16 is the only cross-profile LN path
                    today; this surfaces a clear remediation. */}
                {crossProfileLnNoAddress && (
                  <Text style={styles.warningText} testID="transfer-cross-profile-no-lud16">
                    {t('transferSheet.crossProfileNoLud16')}
                  </Text>
                )}

                {/* Action buttons */}
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={onClose}
                    testID="transfer-cancel"
                    accessibilityLabel={t('transferSheet.cancelTransfer')}
                  >
                    <Text style={styles.cancelButtonText}>{t('transferSheet.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.transferButton,
                      (!canTransfer || sending) && styles.buttonDisabled,
                    ]}
                    onPress={handleTransfer}
                    disabled={!canTransfer || sending}
                    testID="transfer-execute"
                    accessibilityLabel={t('transferSheet.executeTransfer')}
                  >
                    <Text style={styles.transferButtonText}>
                      {t('transferSheet.transferButton')}
                    </Text>
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
