/**
 * Global LNURL-withdraw claim bottom sheet (#341).
 *
 * Opened imperatively from the deep-link handler (App.tsx) when a standalone
 * `lightning:lnurl…` / `lnurlw://…` tag or link is tapped — i.e. a plain
 * LNURL-withdraw voucher (gift card, bounty sticker), NOT a Hunt/Piglet
 * geo-cache (those keep the full HuntFoundScreen via their own coord route).
 *
 * Deliberately generic — Gift icon, "Claim funds" copy, no Piggy branding,
 * presented as a bottom sheet over whatever screen the user is on rather than
 * a full-screen page.
 *
 * Flow: resolve LUD-03 → fixed-amount (min === max) auto-claims; variable
 * (min < max) shows an amount picker (slider + typed field, default max, fiat
 * hint) → claim into the active wallet.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import Slider from '@react-native-community/slider';
import { Gift, PartyPopper } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import {
  LnurlWithdrawError,
  LnurlWithdrawParams,
  claimLnurlWithdraw,
  resolveLnurlWithdraw,
} from '../services/lnurlWithdrawService';
import { recordClaim } from '../services/claimHistoryService';
import { paymentHashFromBolt11 } from '../utils/bolt11';
import { friendlyClaimError } from '../utils/claimErrorMessage';
import { SLEEPING_PATTERN, parseCooldownSeconds, formatCountdown } from '../utils/lnurlCooldown';
import { createLnurlWithdrawSheetStyles } from '../styles/LnurlWithdrawSheet.styles';

// Imperative open — mirrors the BrandedAlert host pattern so the global
// deep-link handler can pop the sheet without a screen in scope.
let listener: ((lnurl: string) => void) | null = null;
/** Open the global withdraw sheet for `lnurl`. Returns false if the host
 *  isn't mounted yet (cold launch race) so the caller can retry. */
export function openLnurlWithdrawSheet(lnurl: string): boolean {
  if (listener) {
    listener(lnurl);
    return true;
  }
  return false;
}

const FIAT_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  CAD: 'C$',
  AUD: 'A$',
  CHF: 'CHF ',
  ZAR: 'R',
};

// Fallback copy when a cooldown carries no parseable time hint (budget
// exhausted, generic 'already used') — the live countdown can't run, so show
// static text instead.
const COOLDOWN_NO_HINT =
  'Cooldown is still running, or the sats budget is used up. Try again later.';

type Stage =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'ready'; params: LnurlWithdrawParams }
  | { kind: 'claiming' }
  // `remaining` drives the live countdown (null = no time hint from the server).
  | { kind: 'sleeping'; remaining: number | null }
  | { kind: 'claimed'; sats: number }
  | { kind: 'error'; reason: string };

export function LnurlWithdrawHost(): React.ReactElement {
  const colors = useThemeColors();
  const styles = useMemo(() => createLnurlWithdrawSheetStyles(colors), [colors]);
  const { activeWalletId, makeInvoice, btcPrice, currency, expectPayment } = useWallet();

  const sheetRef = useRef<BottomSheetModal>(null);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const [lnurl, setLnurl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [amountSats, setAmountSats] = useState<number>(0);

  const minSats = stage.kind === 'ready' ? Math.ceil(stage.params.minWithdrawable / 1000) : 0;
  const maxSats = stage.kind === 'ready' ? Math.floor(stage.params.maxWithdrawable / 1000) : 0;

  const fiatLabel = useMemo(() => {
    if (!btcPrice || amountSats <= 0) return null;
    const value = (amountSats / 1e8) * btcPrice;
    const num = value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const symbol = FIAT_SYMBOLS[currency] ?? '';
    return symbol ? `≈ ${symbol}${num}` : `≈ ${num} ${currency}`;
  }, [amountSats, btcPrice, currency]);

  const handleClaim = useCallback(
    async (params: LnurlWithdrawParams, sats: number, sourceLnurl: string) => {
      if (!activeWalletId) {
        setStage({
          kind: 'error',
          reason: 'No wallet connected — add a Lightning wallet (NWC) first, then try again.',
        });
        return;
      }
      setStage({ kind: 'claiming' });
      try {
        const msat = sats * 1000;
        const result = await claimLnurlWithdraw(
          { ...params, minWithdrawable: msat, maxWithdrawable: msat },
          async (s, memo) => makeInvoice(s, memo),
        );
        if (!mountedRef.current) return;
        await recordClaim({ lnurl: sourceLnurl, sats: result.sats });
        if (!mountedRef.current) return;
        setStage({ kind: 'claimed', sats: result.sats });
        // Register the invoice with the wallet context's ~1s aggressive poll so
        // the incoming-payment celebration fires and the balance + transaction
        // list refresh within ~1s of the issuer paying. Without this the only
        // signal is the baseline 30s balance poll, so the sats don't appear
        // until a manual pull-to-refresh. Mirrors NfcReadSheet (#341 follow-up).
        const paymentHash = paymentHashFromBolt11(result.bolt11);
        if (paymentHash) {
          expectPayment(activeWalletId, paymentHash, result.sats);
        }
      } catch (e) {
        if (!mountedRef.current) return;
        const reason =
          e instanceof LnurlWithdrawError ? e.message : ((e as Error).message ?? 'Unknown error');
        // A "you must wait N / cooldown / used-up budget" reply is a benign
        // "come back later" — LNbits reusable links rate-limit between uses.
        // Drive a live countdown from the parsed seconds (null → static copy).
        if (SLEEPING_PATTERN.test(reason)) {
          setStage({ kind: 'sleeping', remaining: parseCooldownSeconds(reason) });
          return;
        }
        // LNURL-issuer errors are meaningful → show as-is. Wallet-side NWC/relay
        // failures surface a cryptic SDK string ("reply timeout: event …") → map
        // to friendly copy (#734).
        const friendly =
          e instanceof LnurlWithdrawError ? null : friendlyClaimError(reason, 'the funds');
        setStage({ kind: 'error', reason: friendly ?? reason });
      }
    },
    [activeWalletId, makeInvoice, expectPayment],
  );

  // Open + resolve when a deep-link fires.
  useEffect(() => {
    listener = (url: string) => {
      if (!mountedRef.current) return;
      setLnurl(url);
      setStage({ kind: 'resolving' });
      sheetRef.current?.present();
    };
    return () => {
      listener = null;
    };
  }, []);

  // Resolve whenever a new lnurl is set. Fixed-amount → auto-claim; variable
  // → show the picker.
  useEffect(() => {
    if (!lnurl || stage.kind !== 'resolving') return;
    let cancelled = false;
    (async () => {
      try {
        const params = await resolveLnurlWithdraw(lnurl);
        if (cancelled || !mountedRef.current) return;
        if (params.maxWithdrawable <= 0) {
          setStage({ kind: 'sleeping', remaining: null });
          return;
        }
        // Show what's on the voucher (and the amount picker) regardless of
        // wallet state — only require a connected wallet at Redeem time. A user
        // scanning a gift card should see its value before being told to add a
        // wallet; `handleClaim` guards the actual claim.
        // Whole-sat bounds. `lo`/`hi` can invert (hi < lo) when the issuer's
        // millisat range brackets no integer sat (e.g. 2500–2999 msat → lo=3,
        // hi=2). Auto-claiming hi there sends an amount below min and the claim
        // always fails — surface it as an error instead.
        const lo = Math.ceil(params.minWithdrawable / 1000);
        const hi = Math.floor(params.maxWithdrawable / 1000);
        if (hi < lo) {
          setStage({
            kind: 'error',
            reason: "This voucher's amount can't be claimed in whole sats.",
          });
          return;
        }
        if (lo < hi) {
          setAmountSats(hi);
          setStage({ kind: 'ready', params });
          return;
        }
        await handleClaim(params, hi, lnurl);
      } catch (e) {
        if (cancelled || !mountedRef.current) return;
        const reason =
          e instanceof LnurlWithdrawError
            ? e.message
            : `Could not resolve LNURL: ${(e as Error).message}`;
        setStage({ kind: 'error', reason });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lnurl, stage.kind, activeWalletId, handleClaim]);

  // Tick the cooldown countdown each second while sleeping. Decrements the
  // `remaining` carried in the sleeping stage; stops at 0 (the user can then
  // re-scan to retry). Mirrors the geo-cache prize sheet (NfcReadSheet).
  const sleepingRemaining = stage.kind === 'sleeping' ? stage.remaining : null;
  useEffect(() => {
    if (sleepingRemaining === null || sleepingRemaining <= 0) return;
    const t = setInterval(() => {
      setStage((s) =>
        s.kind === 'sleeping' && s.remaining !== null && s.remaining > 0
          ? { ...s, remaining: s.remaining - 1 }
          : s,
      );
    }, 1000);
    return () => clearInterval(t);
  }, [sleepingRemaining]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  const close = () => sheetRef.current?.dismiss();

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      // The native Slider needs the horizontal drag — without this the sheet's
      // content pan-gesture swallows it and the thumb won't move. The sheet is
      // still draggable/dismissable via its handle + backdrop.
      enableContentPanningGesture={false}
      // Lift the sheet above the keyboard so the typed amount field stays
      // visible (paired with BottomSheetTextInput below).
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
      backdropComponent={renderBackdrop}
      onDismiss={() => {
        setLnurl(null);
        setStage({ kind: 'idle' });
        setAmountSats(0);
      }}
    >
      <BottomSheetView style={styles.content} testID="lnurl-withdraw-sheet">
        {(stage.kind === 'resolving' || stage.kind === 'claiming') && (
          <>
            <View style={styles.iconWrap}>
              <Gift size={56} color={colors.brandPink} strokeWidth={2} />
            </View>
            <Text style={styles.title}>Claim funds</Text>
            <ActivityIndicator size="large" color={colors.brandPink} style={{ marginTop: 4 }} />
            <Text style={styles.fineprint}>
              {stage.kind === 'resolving' ? 'Looking up this voucher…' : 'Claiming sats…'}
            </Text>
          </>
        )}

        {stage.kind === 'ready' && (
          <>
            <View style={styles.iconWrap}>
              <Gift size={56} color={colors.brandPink} strokeWidth={2} />
            </View>
            <Text style={styles.title}>Claim funds</Text>
            {stage.params.defaultDescription ? (
              <Text style={styles.memo}>&ldquo;{stage.params.defaultDescription}&rdquo;</Text>
            ) : null}
            <Text style={styles.amountValue} testID="lnurl-withdraw-amount-sats">
              {amountSats.toLocaleString()} sats
            </Text>
            {fiatLabel ? <Text style={styles.amountFiat}>{fiatLabel}</Text> : null}
            <Slider
              style={styles.slider}
              minimumValue={minSats}
              maximumValue={maxSats}
              step={1}
              value={amountSats}
              onValueChange={(v) => setAmountSats(Math.round(v))}
              minimumTrackTintColor={colors.brandPink}
              maximumTrackTintColor={colors.textSupplementary}
              thumbTintColor={colors.brandPink}
              testID="lnurl-withdraw-amount-slider"
            />
            <View style={styles.rangeRow}>
              <Text style={styles.rangeText}>{minSats.toLocaleString()}</Text>
              <Text style={styles.rangeText}>{maxSats.toLocaleString()} max</Text>
            </View>
            <View style={styles.amountInputRow}>
              <BottomSheetTextInput
                style={styles.amountInput}
                keyboardType="number-pad"
                value={String(amountSats)}
                onChangeText={(t) => {
                  const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
                  setAmountSats(
                    Number.isFinite(n) ? Math.min(maxSats, Math.max(minSats, n)) : minSats,
                  );
                }}
                testID="lnurl-withdraw-amount-input"
                accessibilityLabel="Claim amount in sats"
              />
              <Text style={styles.amountInputUnit}>sats</Text>
            </View>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => lnurl && handleClaim(stage.params, amountSats, lnurl)}
              accessibilityLabel={`Claim ${amountSats} sats`}
              testID="lnurl-withdraw-claim-button"
            >
              <Gift size={20} color={colors.white} strokeWidth={2.5} />
              <Text style={styles.primaryButtonText}>
                Redeem {amountSats.toLocaleString()} sats
              </Text>
            </TouchableOpacity>
          </>
        )}

        {stage.kind === 'claimed' && (
          <>
            <View style={styles.iconWrapSuccess}>
              <PartyPopper size={56} color={colors.green} strokeWidth={2} />
            </View>
            <Text style={styles.title}>{stage.sats.toLocaleString()} sats inbound!</Text>
            <Text style={styles.memo}>
              Sent to your wallet — the celebration fires when they land.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={close}
              testID="lnurl-withdraw-done-button"
            >
              <Text style={styles.primaryButtonText}>Done</Text>
            </TouchableOpacity>
          </>
        )}

        {stage.kind === 'sleeping' && (
          <>
            <View style={styles.iconWrap}>
              <Gift size={56} color={colors.textSupplementary} strokeWidth={1.5} />
            </View>
            <Text style={styles.title}>On cooldown</Text>
            {stage.remaining !== null && stage.remaining > 0 ? (
              <>
                <Text style={styles.countdown} testID="lnurl-withdraw-cooldown">
                  {formatCountdown(stage.remaining)}
                </Text>
                <Text style={styles.memo}>
                  This voucher was claimed recently — it unlocks when the timer hits zero. Scan
                  again then.
                </Text>
              </>
            ) : stage.remaining === 0 ? (
              <Text style={styles.memo}>Unlocked — scan again to claim.</Text>
            ) : (
              <Text style={styles.memo}>{COOLDOWN_NO_HINT}</Text>
            )}
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={close}
              testID="lnurl-withdraw-close-button"
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </>
        )}

        {stage.kind === 'error' && (
          <>
            <View style={styles.iconWrap}>
              <Gift size={56} color={colors.textSupplementary} strokeWidth={1.5} />
            </View>
            <Text style={styles.title}>Couldn&rsquo;t claim</Text>
            <Text style={styles.memo}>{stage.reason}</Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={close}
              testID="lnurl-withdraw-close-button"
            >
              <Text style={styles.secondaryButtonText}>Close</Text>
            </TouchableOpacity>
          </>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
}
