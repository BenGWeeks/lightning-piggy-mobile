import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  BackHandler,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { AlertCircle, Moon, Nfc, PartyPopper } from 'lucide-react-native';
import {
  readHuntTagPayload,
  cancelNfcOperation,
  isNfcEnabled,
} from '../services/nfcService';
import {
  LnurlWithdrawError,
  claimLnurlWithdraw,
  resolveLnurlWithdraw,
} from '../services/lnurlWithdrawService';
import { recordClaim } from '../services/claimHistoryService';
import { useThemeColors } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import type { Palette } from '../styles/palettes';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Cache coord we expect the tag to belong to. If the tag's `coord`
   * field doesn't match, the read is rejected with a "wrong Piglet"
   * error rather than silently letting the user claim against the
   * wrong cache. */
  expectedCoord: string;
}

// Sheet lifecycle: from 'ready' (waiting for the user to tap a tag) all
// the way through to the prize outcome. Pre-fix, the sheet handed off
// to a separate HuntFoundScreen after extracting the LNURL — too much
// navigation churn for a one-tap action. The full flow now stays
// in-sheet so the user lands back on the cache detail (with the find-
// log composer already in view) the moment they dismiss.
type SheetStage =
  | 'ready'
  | 'reading'
  | 'claiming'
  | 'claimed'
  | 'sleeping'
  | 'error';

const SLEEPING_PATTERN = /wait[_ ]?time|cooldown|budget|sleeping|exhausted|already used/i;

// LNbits-style 'Wait 927 seconds.' / 'wait_time: 240' / 'cooldown 600s'
// — we don't know who triggered the cooldown (any finder could have
// just scanned), so the phrasing should be neutral. Returns a tidy
// 'about 15 minutes' / 'about 2 minutes' / 'a few seconds' string when
// it can extract a number from the LNURLw's reason, or null when the
// server's message has no time hint at all.
const friendlyCooldown = (raw: string): string | null => {
  const m = raw.match(/(\d{1,5})\s*(?:s|sec|seconds?)?/i);
  if (!m) return null;
  const total = Number(m[1]);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (total < 30) return 'a few seconds';
  if (total < 90) return 'about a minute';
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
};

const NfcReadSheet: React.FC<Props> = ({ visible, onClose, expectedCoord }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { activeWalletId, makeInvoice } = useWallet();
  const [stage, setStage] = useState<SheetStage>('ready');
  const [errorMessage, setErrorMessage] = useState('');
  const [claimedSats, setClaimedSats] = useState<number | null>(null);
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['55%'], []);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const startRead = useCallback(async () => {
    setErrorMessage('');
    setClaimedSats(null);
    const enabled = await isNfcEnabled();
    if (!enabled) {
      if (mountedRef.current) {
        setStage('error');
        setErrorMessage(
          Platform.OS === 'android'
            ? 'NFC is turned off. Please enable NFC in your device settings.'
            : 'NFC is turned off. Go to Settings to enable NFC.',
        );
      }
      return;
    }
    setStage('ready');
    try {
      const result = await readHuntTagPayload({
        onTagDetected: () => {
          if (mountedRef.current) setStage('reading');
        },
      });
      if (result.coord && expectedCoord && result.coord !== expectedCoord) {
        throw new Error(
          "This tag belongs to a different Piglet. Make sure you're scanning the right one.",
        );
      }
      if (!result.lnurl) {
        throw new Error(
          'No prize link on this tag. The hider may have written a tag without an LNURL.',
        );
      }
      if (!activeWalletId) {
        throw new Error('No wallet connected — add a Lightning wallet (NWC) first, then try again.');
      }
      if (!mountedRef.current) return;
      setStage('claiming');
      // Resolve + claim in one go. The user already opted in by holding
      // the tag to the phone; a separate 'tap to confirm' would just
      // add friction.
      try {
        const params = await resolveLnurlWithdraw(result.lnurl);
        if (!mountedRef.current) return;
        if (params.maxWithdrawable <= 0) {
          setStage('sleeping');
          setErrorMessage(
            'This Piggy is sleeping — its cooldown is still running, or its sats budget is used up. Try again later.',
          );
          return;
        }
        const claim = await claimLnurlWithdraw(params, async (sats, memo) =>
          makeInvoice(sats, memo),
        );
        if (!mountedRef.current) return;
        await recordClaim({
          lnurl: result.lnurl,
          sats: claim.sats,
          piggyId: expectedCoord,
        });
        setClaimedSats(claim.sats);
        setStage('claimed');
      } catch (e) {
        if (!mountedRef.current) return;
        const reason =
          e instanceof LnurlWithdrawError ? e.message : ((e as Error).message ?? 'Unknown error');
        if (SLEEPING_PATTERN.test(reason)) {
          setStage('sleeping');
          setErrorMessage(reason);
        } else {
          setStage('error');
          setErrorMessage(reason);
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setStage('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to read NFC tag');
      }
    }
  }, [expectedCoord, activeWalletId, makeInvoice]);

  useEffect(() => {
    if (visible) {
      setStage('ready');
      setErrorMessage('');
      setClaimedSats(null);
      sheetRef.current?.present();
      startRead();
    } else {
      sheetRef.current?.dismiss();
      cancelNfcOperation();
      setStage('ready');
      setErrorMessage('');
      setClaimedSats(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleRetry = () => {
    cancelNfcOperation();
    startRead();
  };

  const handleClose = () => {
    cancelNfcOperation();
    onClose();
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      onDismiss={handleClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>Try the prize</Text>

        {stage === 'ready' && (
          <View style={styles.stateContainer}>
            <View style={styles.iconContainer}>
              <Nfc size={64} color={colors.brandPink} strokeWidth={2} />
            </View>
            <Text style={styles.instruction}>Hold the Piglet to the back of your phone</Text>
            <Text style={styles.description}>
              We'll read the tag and try to claim the sats prize automatically.
            </Text>
            <ActivityIndicator
              size="small"
              color={colors.brandPink}
              style={styles.waitingIndicator}
            />
            <Text style={styles.waitingText}>Waiting for NFC tag…</Text>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleClose}
              accessibilityLabel="Cancel NFC scan"
              testID="nfc-read-cancel"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {(stage === 'reading' || stage === 'claiming') && (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={colors.brandPink} />
            <Text style={styles.instruction}>
              {stage === 'reading' ? 'Reading…' : 'Claiming sats…'}
            </Text>
          </View>
        )}

        {stage === 'claimed' && (
          <View style={styles.stateContainer}>
            <View style={[styles.iconContainer, styles.successIcon]}>
              <PartyPopper size={64} color={colors.green} strokeWidth={2} />
            </View>
            <Text style={styles.instruction}>
              {claimedSats?.toLocaleString() ?? ''} sats inbound!
            </Text>
            <Text style={styles.description}>
              Sent to your active wallet — the receive toast fires the moment they land.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleClose}
              accessibilityLabel="Dismiss prize sheet"
              testID="nfc-read-done"
            >
              <Text style={styles.primaryButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'sleeping' && (
          <View style={styles.stateContainer}>
            <View style={[styles.iconContainer, styles.sleepingIcon]}>
              <Moon size={64} color={colors.textSupplementary} strokeWidth={2} />
            </View>
            <Text style={styles.instruction}>Piggy is sleeping</Text>
            <Text style={styles.description}>
              {(() => {
                const cooldown = friendlyCooldown(errorMessage);
                if (cooldown) {
                  return `Another finder claimed recently — try again in ${cooldown}.`;
                }
                return 'Cooldown is still running, or the sats budget is used up. Try again later.';
              })()}
            </Text>
            <View style={styles.errorButtons}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={handleRetry}
                accessibilityLabel="Try again"
                testID="nfc-read-sleep-retry"
              >
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleClose}
                accessibilityLabel="Dismiss"
                testID="nfc-read-sleep-cancel"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {stage === 'error' && (
          <View style={styles.stateContainer}>
            <View style={[styles.iconContainer, styles.errorIcon]}>
              <Nfc size={64} color={colors.red} strokeWidth={2} />
              <View style={styles.errorBadge}>
                <AlertCircle size={26} color={colors.red} strokeWidth={2.5} />
              </View>
            </View>
            <Text style={styles.instruction}>Couldn't claim</Text>
            <Text style={styles.description}>{errorMessage}</Text>
            <View style={styles.errorButtons}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={handleRetry}
                accessibilityLabel="Retry"
                testID="nfc-read-retry"
              >
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleClose}
                accessibilityLabel="Cancel"
                testID="nfc-read-error-cancel"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
    },
    handleIndicator: {
      backgroundColor: colors.divider,
      width: 40,
    },
    content: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 40,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 24,
    },
    stateContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
    },
    iconContainer: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    successIcon: { backgroundColor: colors.greenLight },
    sleepingIcon: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.divider },
    errorIcon: { backgroundColor: colors.redLight },
    errorBadge: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 1,
    },
    instruction: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      textAlign: 'center',
      marginBottom: 8,
    },
    description: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 20,
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    waitingIndicator: { marginBottom: 8 },
    waitingText: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginBottom: 24,
    },
    primaryButton: {
      paddingHorizontal: 48,
      paddingVertical: 14,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    primaryButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.white,
    },
    cancelButton: {
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.divider,
    },
    cancelButtonText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    errorButtons: {
      flexDirection: 'row',
      gap: 12,
    },
    retryButton: {
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    retryButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.white,
    },
  });

export default NfcReadSheet;
