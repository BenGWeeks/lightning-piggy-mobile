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
import { Nfc, AlertCircle, Copy, Eye, EyeOff, Lock } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { Toast } from './BrandedToast';
import {
  writeNpubToTag,
  writeLnurlToTag,
  writeHuntTagToTag,
  cancelNfcOperation,
  isNfcEnabled,
  type HuntTagPayload,
} from '../services/nfcService';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * Write mode. `npub` (default) writes a Nostr identity to a contact's
   * tag; `piglet` writes an LNURL-withdraw prize link to a Hide-a-Piglet
   * tag and locks it so a passer-by can't repoint it.
   */
  mode?: 'npub' | 'piglet';
  /** npub mode — the Nostr identity to write + the name shown in copy. */
  npub?: string;
  displayName?: string;
  /** piglet mode — the LNURL-withdraw link to write to the tag.
   * Legacy single-record path used when `huntPayload` is absent. */
  lnurl?: string;
  /** piglet mode (preferred) — multi-record NDEF payload: lightningpiggy://
   * deep link + nostr:naddr1 listing reference + optional LNURL. When
   * supplied, takes precedence over `lnurl`. See #73. */
  huntPayload?: HuntTagPayload;
  /** piglet mode — when true (default) the Android write path also sets
   * a random PWD/PACK on the tag and returns the resulting PIN via
   * `onWritten`. Set false to publish an unlocked tag. iOS always writes
   * unlocked regardless. Issue #567. */
  lockTag?: boolean;
  /** piglet edit mode — when the Piglet was previously locked, pass the
   * stored secrets so the write path PWD_AUTHs the chip before writing
   * the new NDEF payload. The PIN stays the same after the rewrite —
   * the hider doesn't have to track a fresh one. Issue #567. */
  existingLock?: { pwdHex: string; packHex: string };
  /** Fires once the tag write succeeds (before the user dismisses).
   * Receives the lock secrets when the locked-write path ran — caller
   * persists them on the matching `HiddenPiggy` so the PIN can be
   * surfaced in My Piglets and the unlock flow can authenticate later. */
  onWritten?: (result?: {
    locked: boolean;
    lock?: { pwdHex: string; packHex: string; pin: string; tagUid: string };
  }) => void;
}

type WriteState = 'ready' | 'writing' | 'success' | 'error';

const NfcWriteSheet: React.FC<Props> = ({
  visible,
  onClose,
  mode = 'npub',
  npub = '',
  displayName = '',
  lnurl = '',
  huntPayload,
  lockTag = true,
  existingLock,
  onWritten,
}) => {
  const isPiglet = mode === 'piglet';
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [state, setState] = useState<WriteState>('ready');
  const [errorMessage, setErrorMessage] = useState('');
  // Lock outcome from the most recent write. Drives the inline PIN
  // reveal on the success state so the hider sees the PIN the instant
  // the chip confirms — no need to dismiss the sheet first. Issue #567.
  const [lastLock, setLastLock] = useState<{
    pwdHex: string;
    packHex: string;
    pin: string;
    tagUid: string;
  } | null>(null);
  const [pinRevealed, setPinRevealed] = useState(false);
  // No explicit snapPoints — gorhom v5's `enableDynamicSizing={true}`
  // (the default) sizes the sheet to its content, so the error state
  // with a long diagnostic message gets a tall sheet, the simple
  // success state gets a short one, and the user never has to swipe
  // the sheet up to see hidden content. Project rule: no hardcoded
  // sheet heights unless we genuinely need a fixed snap point.
  const sheetRef = useRef<BottomSheetModal>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setState('ready');
      setErrorMessage('');
      // Also clear the previous PIN — reopening the sheet either re-
      // writes (fresh secrets) or unlock-then-rewrite (same PIN, but
      // we'll re-receive it via writeResult). Either way, leaking the
      // old PIN into the new ready/error state is wrong.
      setLastLock(null);
      setPinRevealed(false);
      sheetRef.current?.present();
      startWrite();
    } else {
      sheetRef.current?.dismiss();
      cancelNfcOperation();
      // Reset on close too — the BottomSheet keeps the component mounted,
      // so a previous error / success state would persist into the next
      // open without this. Pre-fix the user reopened the sheet after a
      // capacity-error and still saw the old "Tag payload is N bytes"
      // copy (#73 follow-up).
      setState('ready');
      setErrorMessage('');
      setLastLock(null);
      setPinRevealed(false);
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

  const startWrite = async () => {
    const enabled = await isNfcEnabled();
    if (!enabled) {
      if (mountedRef.current) {
        setState('error');
        setErrorMessage(
          Platform.OS === 'android'
            ? 'NFC is turned off. Please enable NFC in your device settings.'
            : 'NFC is turned off. Go to Settings to enable NFC.',
        );
      }
      return;
    }

    setState('ready');
    try {
      const onTagDetected = () => {
        // Tag detected — show writing state
        if (mountedRef.current) setState('writing');
      };
      let writeResult: Awaited<ReturnType<typeof writeHuntTagToTag>> | null = null;
      if (isPiglet) {
        // New multi-record write when the caller supplies the richer
        // Hunt payload (#73); legacy single-record LNURL write stays
        // as the fallback so we don't break any pre-#73 call-site. The
        // hunt-payload path also threads the lock toggle through —
        // single-record LNURL writes don't currently expose locking.
        if (huntPayload) {
          writeResult = await writeHuntTagToTag({
            ...huntPayload,
            onTagDetected,
            lockTag,
            existingLock,
          });
        } else {
          // Private Piglet — no nostr:naddr to emit, just the LNURL
          // bearer record. The locked-write path still applies on
          // Android so a passer-by can't repoint the chip (Copilot
          // #572 review: this branch used to silently fall back to
          // the irreversible `makeReadOnly` lock even when the
          // wizard toggle was on). The single-record writer routes
          // through the same MifareUltralight helper as the
          // multi-record path when lockTag is true.
          const result = await writeLnurlToTag({
            lnurl,
            onTagDetected,
            lockTag,
            existingLock,
          });
          writeResult = result;
        }
      } else {
        await writeNpubToTag(npub, onTagDetected);
      }
      if (mountedRef.current) {
        if (writeResult?.lock) {
          setLastLock(writeResult.lock);
        } else {
          setLastLock(null);
        }
        setPinRevealed(false);
        setState('success');
        onWritten?.(
          writeResult ? { locked: writeResult.locked, lock: writeResult.lock } : undefined,
        );
      }
    } catch (err) {
      if (mountedRef.current) {
        setState('error');
        const msg = err instanceof Error ? err.message : 'Failed to write to NFC tag';
        setErrorMessage(msg);
      }
    }
  };

  const handleRetry = () => {
    cancelNfcOperation();
    startWrite();
  };

  const handleClose = () => {
    cancelNfcOperation();
    onClose();
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      onDismiss={handleClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>{isPiglet ? 'Write the Piglet tag' : 'Write to NFC'}</Text>

        {state === 'ready' && (
          <View style={styles.stateContainer}>
            <View style={styles.iconContainer}>
              <Nfc size={64} color={colors.brandPink} strokeWidth={2} />
            </View>
            <Text style={styles.instruction}>
              {isPiglet
                ? 'Hold the Piglet to the back of your phone'
                : 'Hold your phone against an NFC tag'}
            </Text>
            <Text style={styles.description}>
              {isPiglet
                ? // Honest copy keyed to the actual write mode (Copilot
                  // #572 review). The legacy "and locks it" claim ran
                  // even when `lockTag` was false or the platform was
                  // iOS (no lock primitive in the lib today). We split
                  // the three real cases so the hider knows what's
                  // about to happen.
                  lockTag && Platform.OS === 'android' && huntPayload
                  ? 'This writes the prize link onto the tag and password-locks the chip so no-one can overwrite it. Keep the Piglet still against the phone until it confirms.'
                  : Platform.OS !== 'android'
                    ? "This writes the prize link onto the tag. iOS doesn't support our reversible lock yet, so the chip stays open — anyone with an NFC writer could repoint it."
                    : 'This writes the prize link onto the tag and leaves the chip open. Anyone with an NFC writer can later overwrite it — turn on Lock the tag on the previous screen to password-protect.'
                : `This will write ${displayName}'s Nostr identity (npub) to the tag. Anyone with a Nostr-compatible app can tap the tag to view the profile.`}
            </Text>
            {!isPiglet && (
              <Text style={styles.npubPreview} numberOfLines={1}>
                {npub.slice(0, 20)}...{npub.slice(-8)}
              </Text>
            )}
            <ActivityIndicator
              size="small"
              color={colors.brandPink}
              style={styles.waitingIndicator}
            />
            <Text style={styles.waitingText}>Waiting for NFC tag...</Text>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleClose}
              accessibilityLabel="Cancel NFC write"
              testID="nfc-write-cancel"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'writing' && (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={colors.brandPink} />
            <Text style={styles.instruction}>Writing to tag...</Text>
          </View>
        )}

        {state === 'success' && (
          <View style={styles.stateContainer}>
            <View style={[styles.iconContainer, styles.successIcon]}>
              <Text style={styles.checkmark}>&#10003;</Text>
            </View>
            <Text style={styles.instruction}>
              {isPiglet && lastLock ? 'Successfully written and locked' : 'Successfully written!'}
            </Text>
            <Text style={styles.description}>
              {isPiglet
                ? lastLock
                  ? 'The prize link is on the tag and the chip is password-protected so no-one can overwrite it. Save the PIN below — you’ll need it to repoint the tag later.'
                  : 'The prize link is on the tag. Anyone with an NFC writer can still overwrite it — flip the Lock toggle on the previous screen to password-protect this chip on a re-write.'
                : `${displayName}'s npub has been written to the NFC tag. Anyone can now tap this tag to view the profile.`}
            </Text>
            {isPiglet && lastLock ? (
              <View style={styles.pinCard} testID="nfc-write-pin-card">
                <View style={styles.pinHeaderRow}>
                  <Lock size={13} color={colors.brandPink} strokeWidth={2.5} />
                  <Text style={styles.pinHeaderText}>Your PIN</Text>
                </View>
                <TouchableOpacity
                  style={styles.pinValueRow}
                  onPress={() => setPinRevealed((v) => !v)}
                  accessibilityLabel={pinRevealed ? 'Hide PIN' : 'Reveal PIN'}
                  testID="nfc-write-pin-reveal"
                >
                  <Text style={styles.pinValueText}>{pinRevealed ? lastLock.pin : '••••••••'}</Text>
                  {pinRevealed ? (
                    <EyeOff size={16} color={colors.textSupplementary} strokeWidth={2} />
                  ) : (
                    <Eye size={16} color={colors.textSupplementary} strokeWidth={2} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.pinCopyButton}
                  onPress={async () => {
                    await Clipboard.setStringAsync(lastLock.pin);
                    Toast.show({ type: 'success', text1: 'PIN copied' });
                  }}
                  accessibilityLabel="Copy PIN"
                  testID="nfc-write-pin-copy"
                >
                  <Copy size={14} color={colors.brandPink} strokeWidth={2.5} />
                  <Text style={styles.pinCopyButtonText}>Copy</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.doneButton}
              onPress={handleClose}
              accessibilityLabel="Close NFC write sheet"
              testID="nfc-write-done"
            >
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'error' && (
          <View style={styles.stateContainer}>
            <View style={[styles.iconContainer, styles.errorIcon]}>
              <Nfc size={64} color={colors.red} strokeWidth={2} />
              <View style={styles.errorBadge}>
                <AlertCircle size={26} color={colors.red} strokeWidth={2.5} />
              </View>
            </View>
            <Text style={styles.instruction}>Write failed</Text>
            <Text style={styles.description}>{errorMessage}</Text>
            <View style={styles.errorButtons}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={handleRetry}
                accessibilityLabel="Retry NFC write"
                testID="nfc-write-retry"
              >
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleClose}
                accessibilityLabel="Cancel NFC write"
                testID="nfc-write-error-cancel"
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
      // No `flex: 1` — that overrides gorhom v5's content-driven
      // sizing and forces the sheet to fill the screen instead of
      // hugging its content. Project rule: no hardcoded sheet heights.
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
      // Hugs its children so dynamic sheet sizing measures the true
      // content height. The flex:1 we had here pushed the sheet to
      // full-screen and forced the user to swipe up to see the
      // diagnostic message on error.
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
    successIcon: {
      backgroundColor: colors.greenLight,
    },
    errorIcon: {
      // Theme-aware error tint — `redLight` is a tuned light/dark
      // pair in the palette so the dark-theme variant doesn't
      // produce eye-burn against the dark surface.
      backgroundColor: colors.redLight,
    },
    checkmark: {
      fontSize: 48,
      color: colors.green,
      fontWeight: '700',
    },
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
    npubPreview: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textSupplementary,
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: 16,
    },
    waitingIndicator: {
      marginBottom: 8,
    },
    waitingText: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginBottom: 24,
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
    doneButton: {
      paddingHorizontal: 48,
      paddingVertical: 14,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    doneButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.white,
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
    // ---- Post-write PIN card (success state, #567) -----------------------
    pinCard: {
      width: '100%',
      padding: 12,
      marginBottom: 16,
      borderRadius: 12,
      backgroundColor: colors.brandPinkLight,
      borderWidth: 1,
      borderColor: colors.brandPink,
      gap: 8,
    },
    pinHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    pinHeaderText: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.brandPink,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    pinValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    pinValueText: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      letterSpacing: 2,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    pinCopyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.brandPink,
      backgroundColor: colors.surface,
    },
    pinCopyButtonText: { fontSize: 12, fontWeight: '700', color: colors.brandPink },
  });

export default NfcWriteSheet;
