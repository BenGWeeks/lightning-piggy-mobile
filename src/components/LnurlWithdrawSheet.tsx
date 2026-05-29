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
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
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

const friendlyCooldownReason = (raw: string): string => {
  const m = raw.match(/(\d{1,5})\s*(?:s|sec|seconds?)?/i);
  const total = m ? Number(m[1]) : 0;
  if (!Number.isFinite(total) || total <= 0) {
    return 'Cooldown is still running, or the sats budget is used up. Try again later.';
  }
  if (total < 90) return 'Claimed very recently — try again in a moment.';
  const minutes = Math.round(total / 60);
  if (minutes < 60)
    return `Claimed recently — try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  const hours = Math.round(total / 3600);
  return `Claimed recently — try again in about ${hours} hour${hours === 1 ? '' : 's'}.`;
};

type Stage =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'ready'; params: LnurlWithdrawParams }
  | { kind: 'claiming' }
  | { kind: 'claimed'; sats: number }
  | { kind: 'sleeping'; reason: string }
  | { kind: 'error'; reason: string };

export function LnurlWithdrawHost(): React.ReactElement {
  const colors = useThemeColors();
  const styles = useMemo(() => createLnurlWithdrawSheetStyles(colors), [colors]);
  const { activeWalletId, makeInvoice, btcPrice, currency } = useWallet();

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
      } catch (e) {
        if (!mountedRef.current) return;
        const reason =
          e instanceof LnurlWithdrawError ? e.message : ((e as Error).message ?? 'Unknown error');
        const sleepy = /wait[_ ]?time|cooldown|budget|sleeping|exhausted|already used/i.test(
          reason,
        );
        setStage(
          sleepy
            ? { kind: 'sleeping', reason: friendlyCooldownReason(reason) }
            : { kind: 'error', reason },
        );
      }
    },
    [activeWalletId, makeInvoice],
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
          setStage({ kind: 'sleeping', reason: friendlyCooldownReason('') });
          return;
        }
        if (!activeWalletId) {
          setStage({
            kind: 'error',
            reason: 'No wallet connected — add a Lightning wallet (NWC) first, then try again.',
          });
          return;
        }
        const lo = Math.ceil(params.minWithdrawable / 1000);
        const hi = Math.floor(params.maxWithdrawable / 1000);
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
              <TextInput
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

        {(stage.kind === 'sleeping' || stage.kind === 'error') && (
          <>
            <View style={styles.iconWrap}>
              <Gift size={56} color={colors.textSupplementary} strokeWidth={1.5} />
            </View>
            <Text style={styles.title}>
              {stage.kind === 'sleeping' ? 'Nothing to claim right now' : "Couldn't claim"}
            </Text>
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
