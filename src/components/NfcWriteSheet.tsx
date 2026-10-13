import { createNfcWriteSheetStyles as createStyles } from '../styles/NfcWriteSheet.styles';
import BrandedSpinner from './BrandedSpinner';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, BackHandler, Platform } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { BottomSheetModal } from './AccessibleBottomSheetModal';
import { Nfc, AlertCircle, Copy, Eye, EyeOff, Lock } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { Toast } from './BrandedToast';
import {
  writeLnurlToTag,
  writeHuntTagToTag,
  cancelNfcOperation,
  isNfcEnabled,
  type HuntTagPayload,
} from '../services/nfcService';
import { writeNostrProfileToTag } from '../services/nfcNostrWrite';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';

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
  /**
   * npub mode (preferred) — a `nostr:nprofile1…` reference (pubkey +
   * outbox relay hints, NIP-65) to write instead of the bare npub.
   * When supplied it takes precedence over `npub` so a cold first-contact
   * scanner resolves the profile even on niche relays (#755). Bare-bech32
   * (`nprofile1…`) or `nostr:`-prefixed forms both accepted. Falls back to
   * `npub` when absent.
   */
  nostrRef?: string;
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
  nostrRef = '',
  displayName = '',
  lnurl = '',
  huntPayload,
  lockTag = true,
  existingLock,
  onWritten,
}) => {
  const isPiglet = mode === 'piglet';
  const colors = useThemeColors();
  const t = useTranslation();
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
            ? t('nfcWriteSheet.nfcOffAndroid')
            : t('nfcWriteSheet.nfcOffIos'),
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
        // Multi-record write when the caller supplies the richer Hunt
        // payload (#73); single-record LNURL write covers private
        // hides without a published kind 37516. BOTH paths thread the
        // lock toggle through to the same MifareUltralight helper
        // (#567 r3) — pre-fix the single-record fallback silently
        // skipped locking and the toggle was a lie for private
        // Piglets.
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
        // Prefer the nprofile reference (pubkey + relay hints) so the tag
        // resolves on cold first contact; fall back to the bare npub when
        // the caller didn't supply one (#755).
        await writeNostrProfileToTag(nostrRef || npub, onTagDetected);
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
        const msg = err instanceof Error ? err.message : t('nfcWriteSheet.writeFailedGeneric');
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
        <Text style={styles.title}>
          {isPiglet ? t('nfcWriteSheet.titlePiglet') : t('nfcWriteSheet.titleNpub')}
        </Text>

        {state === 'ready' && (
          <View style={styles.stateContainer}>
            <View style={styles.iconContainer}>
              <Nfc size={64} color={colors.brandPink} strokeWidth={2} />
            </View>
            <Text style={styles.instruction}>
              {isPiglet ? t('nfcWriteSheet.holdPiglet') : t('nfcWriteSheet.holdPhone')}
            </Text>
            <Text style={styles.description}>
              {isPiglet
                ? // Honest copy keyed to the actual write mode. Both
                  // the multi-record (public) AND single-record
                  // (private) write paths route the lock toggle
                  // through the same MifareUltralight helper, so the
                  // branch is lockTag + platform only — `huntPayload`
                  // is irrelevant to whether the chip ends up locked.
                  // Copilot #572 r3 caught the stale `huntPayload`
                  // gate that lied to private hiders.
                  Platform.OS !== 'android'
                  ? t('nfcWriteSheet.readyDescPigletIos')
                  : lockTag
                    ? t('nfcWriteSheet.readyDescPigletLocked')
                    : t('nfcWriteSheet.readyDescPigletUnlocked')
                : t('nfcWriteSheet.readyDescNpub', { name: displayName })}
            </Text>
            {!isPiglet && (
              <Text style={styles.npubPreview} numberOfLines={1}>
                {npub.slice(0, 20)}...{npub.slice(-8)}
              </Text>
            )}
            <BrandedSpinner size="small" style={styles.waitingIndicator} />
            <Text style={styles.waitingText}>{t('nfcWriteSheet.waitingForTag')}</Text>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleClose}
              accessibilityLabel={t('nfcWriteSheet.cancelWrite')}
              testID="nfc-write-cancel"
            >
              <Text style={styles.cancelButtonText}>{t('nfcWriteSheet.cancel')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'writing' && (
          <View style={styles.stateContainer}>
            <BrandedSpinner size="large" />
            <Text style={styles.instruction}>{t('nfcWriteSheet.writingToTag')}</Text>
          </View>
        )}

        {state === 'success' && (
          <View style={styles.stateContainer}>
            <View style={[styles.iconContainer, styles.successIcon]}>
              <Text style={styles.checkmark}>&#10003;</Text>
            </View>
            <Text style={styles.instruction}>
              {isPiglet && lastLock ? t('nfcWriteSheet.successLocked') : t('nfcWriteSheet.success')}
            </Text>
            <Text style={styles.description}>
              {isPiglet
                ? lastLock
                  ? t('nfcWriteSheet.successDescPigletLocked')
                  : Platform.OS !== 'android'
                    ? t('nfcWriteSheet.successDescPigletIos')
                    : t('nfcWriteSheet.successDescPigletUnlocked')
                : t('nfcWriteSheet.successDescNpub', { name: displayName })}
            </Text>
            {isPiglet && lastLock ? (
              <View style={styles.pinCard} testID="nfc-write-pin-card">
                <View style={styles.pinHeaderRow}>
                  <Lock size={13} color={colors.brandPink} strokeWidth={2.5} />
                  <Text style={styles.pinHeaderText}>{t('nfcWriteSheet.yourPin')}</Text>
                </View>
                <TouchableOpacity
                  style={styles.pinValueRow}
                  onPress={() => setPinRevealed((v) => !v)}
                  accessibilityLabel={
                    pinRevealed ? t('nfcWriteSheet.hidePin') : t('nfcWriteSheet.revealPin')
                  }
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
                    Toast.show({ type: 'success', text1: t('nfcWriteSheet.pinCopied') });
                  }}
                  accessibilityLabel={t('nfcWriteSheet.copyPin')}
                  testID="nfc-write-pin-copy"
                >
                  <Copy size={14} color={colors.brandPink} strokeWidth={2.5} />
                  <Text style={styles.pinCopyButtonText}>{t('nfcWriteSheet.copy')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.doneButton}
              onPress={handleClose}
              accessibilityLabel={t('nfcWriteSheet.closeSheet')}
              testID="nfc-write-done"
            >
              <Text style={styles.doneButtonText}>{t('nfcWriteSheet.done')}</Text>
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
            <Text style={styles.instruction}>{t('nfcWriteSheet.writeFailed')}</Text>
            <Text style={styles.description}>{errorMessage}</Text>
            <View style={styles.errorButtons}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={handleRetry}
                accessibilityLabel={t('nfcWriteSheet.retryWrite')}
                testID="nfc-write-retry"
              >
                <Text style={styles.retryButtonText}>{t('nfcWriteSheet.tryAgain')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleClose}
                accessibilityLabel={t('nfcWriteSheet.cancelWrite')}
                testID="nfc-write-error-cancel"
              >
                <Text style={styles.cancelButtonText}>{t('nfcWriteSheet.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
};

export default NfcWriteSheet;
