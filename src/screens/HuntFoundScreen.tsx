import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { CheckCircle2, ChevronLeft, PiggyBank, Sparkles } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation, ExploreStackParamList } from '../navigation/types';
import { Alert } from '../components/BrandedAlert';
import {
  LnurlWithdrawError,
  LnurlWithdrawParams,
  claimLnurlWithdraw,
  resolveLnurlWithdraw,
} from '../services/lnurlWithdrawService';
import { recordClaim } from '../services/claimHistoryService';
import type { RouteProp } from '@react-navigation/native';

interface Props {
  navigation: ExploreNavigation;
  route: RouteProp<ExploreStackParamList, 'HuntFound'>;
}

type Stage =
  | { kind: 'resolving' }
  | { kind: 'ready'; params: LnurlWithdrawParams }
  | { kind: 'claiming'; params: LnurlWithdrawParams }
  | { kind: 'claimed'; params: LnurlWithdrawParams; sats: number }
  | { kind: 'sleeping'; reason: string }
  | { kind: 'error'; reason: string };

/**
 * Finder celebration / claim screen for the Hunt feature (#468). Reached
 * either by deep-link (`lightning:LNURL...` URI tap → App.tsx Linking
 * listener → navigateToHuntFound) or by manual entry from elsewhere in
 * the Hunt sub-stack.
 *
 * Resolves the LUD-03 metadata, presents the issuer's memo + per-claim
 * sats, and on tap-to-claim:
 *   1. Asks the active wallet's NWC connection for a bolt11 invoice for
 *      the right amount (`makeInvoice`).
 *   2. POSTs `?k1=…&pr=<invoice>` to the issuer's callback (handled by
 *      `claimLnurlWithdraw`).
 *   3. Records the claim locally so future visits to the same Piggy can
 *      surface "you got 21 sats here 47m ago" + the soft `⚡ claimed`
 *      badge on any kind-1 reply we post (M5 step 3).
 *
 * The actual incoming-payment celebration (confetti + balance bump) fires
 * from `GlobalIncomingPaymentOverlay` when the bolt11 settles — same path
 * any other receive flow uses, no special wiring needed here.
 */
const HuntFoundScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { lnurl, coord } = route.params;
  const { activeWalletId, makeInvoice } = useWallet();

  const [stage, setStage] = useState<Stage>({ kind: 'resolving' });

  // Resolve metadata on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = await resolveLnurlWithdraw(lnurl);
        if (cancelled) return;
        if (params.maxWithdrawable <= 0) {
          setStage({
            kind: 'sleeping',
            reason:
              'This Piggy is sleeping — its cooldown is still running, or its sats budget is used up. Try again later.',
          });
        } else {
          setStage({ kind: 'ready', params });
        }
      } catch (e) {
        if (cancelled) return;
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
  }, [lnurl]);

  const handleClaim = useCallback(async () => {
    if (stage.kind !== 'ready') return;
    if (!activeWalletId) {
      Alert.alert(
        'No wallet connected',
        'Connect a Lightning wallet (NWC) before claiming the Piggy.',
        [{ text: 'OK' }],
      );
      return;
    }
    setStage({ kind: 'claiming', params: stage.params });
    try {
      const result = await claimLnurlWithdraw(stage.params, async (sats, memo) =>
        makeInvoice(sats, memo),
      );
      // Pass `piggyId` so HuntPiggyDetailScreen can match the claim by
      // coord — the detail screen never sees the bearer LNURL string.
      await recordClaim({ lnurl, sats: result.sats, piggyId: coord });
      setStage({ kind: 'claimed', params: stage.params, sats: result.sats });
    } catch (e) {
      const reason =
        e instanceof LnurlWithdrawError ? e.message : ((e as Error).message ?? 'Unknown error');
      // The issuer-said-no path uses the friendly "sleeping" copy when
      // the reason mentions wait_time / cooldown / budget; everything
      // else falls into the generic error branch.
      const sleepy = /wait[_ ]?time|cooldown|budget|sleeping|exhausted|already used/i.test(reason);
      setStage(sleepy ? { kind: 'sleeping', reason } : { kind: 'error', reason });
    }
  }, [stage, activeWalletId, makeInvoice, lnurl, coord]);

  // ----- render -----------------------------------------------------------

  return (
    <View style={styles.container} testID="hunt-found-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Close"
          testID="hunt-found-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Hunt</Text>
        <View style={styles.headerRightSpacer} />
      </View>

      <View style={styles.body}>
        {stage.kind === 'resolving' && (
          <>
            <ActivityIndicator size="large" color={colors.brandPink} />
            <Text style={styles.subtitle}>Looking up this Piggy…</Text>
          </>
        )}

        {(stage.kind === 'ready' || stage.kind === 'claiming') && (
          <>
            <View style={styles.bigPiggy}>
              <PiggyBank size={88} color={colors.brandPink} strokeWidth={2} />
            </View>
            <Text style={styles.title} testID="piggy-found-celebration-screen">
              You found a Piggy!
            </Text>
            {stage.params.defaultDescription ? (
              <Text style={styles.memo}>&ldquo;{stage.params.defaultDescription}&rdquo;</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.primaryButton, stage.kind === 'claiming' && styles.primaryButtonDim]}
              disabled={stage.kind === 'claiming'}
              onPress={handleClaim}
              testID="piggy-claim-button"
              accessibilityLabel={`Claim ${Math.floor(stage.params.maxWithdrawable / 1000)} sats`}
            >
              {stage.kind === 'claiming' ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Sparkles size={20} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.primaryButtonText}>
                    Claim {Math.floor(stage.params.maxWithdrawable / 1000).toLocaleString()} sats
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <Text style={styles.fineprint}>
              Sent to your active wallet. The celebration fires when the sats land.
            </Text>
          </>
        )}

        {stage.kind === 'claimed' && (
          <>
            <CheckCircle2 size={88} color={colors.green} strokeWidth={2} />
            <Text style={styles.title}>Claim sent</Text>
            <Text style={styles.memo}>
              {stage.sats.toLocaleString()} sats incoming. Watch the Home tab for the confetti.
            </Text>
            <Text style={styles.fineprint}>
              Photo + comment compose lands in the next commit on this branch — leave a log entry
              for future hunters.
            </Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => navigation.popToTop()}
              testID="hunt-found-done-button"
            >
              <Text style={styles.secondaryButtonText}>Done</Text>
            </TouchableOpacity>
          </>
        )}

        {stage.kind === 'sleeping' && (
          <>
            <PiggyBank size={88} color={colors.textSupplementary} strokeWidth={1.5} />
            <Text style={styles.title}>This Piggy is sleeping</Text>
            <Text style={styles.memo}>{stage.reason}</Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => navigation.goBack()}
              testID="hunt-found-back-button-2"
            >
              <Text style={styles.secondaryButtonText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {stage.kind === 'error' && (
          <>
            <PiggyBank size={88} color={colors.textSupplementary} strokeWidth={1.5} />
            <Text style={styles.title}>Couldn&apos;t claim</Text>
            <Text style={styles.memo}>{stage.reason}</Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => navigation.goBack()}
              testID="hunt-found-back-button-3"
            >
              <Text style={styles.secondaryButtonText}>Back</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.brandPink,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerRightSpacer: { width: 24 },
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 14,
    },
    bigPiggy: {
      width: 140,
      height: 140,
      borderRadius: 70,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.textHeader,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
    memo: {
      fontSize: 15,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 22,
      fontStyle: 'italic',
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      paddingHorizontal: 28,
      paddingVertical: 16,
      borderRadius: 100,
      marginTop: 6,
    },
    primaryButtonDim: { opacity: 0.7 },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    secondaryButton: {
      paddingVertical: 14,
      paddingHorizontal: 24,
    },
    secondaryButtonText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '700',
    },
    fineprint: {
      fontSize: 12,
      color: colors.textSupplementary,
      textAlign: 'center',
      marginTop: 4,
    },
  });

export default HuntFoundScreen;
