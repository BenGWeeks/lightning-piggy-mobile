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
import { Nfc, AlertCircle } from 'lucide-react-native';
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
  /** Fires once the tag write succeeds (before the user dismisses). */
  onWritten?: () => void;
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
  onWritten,
}) => {
  const isPiglet = mode === 'piglet';
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [state, setState] = useState<WriteState>('ready');
  const [errorMessage, setErrorMessage] = useState('');
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['55%'], []);
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
      if (isPiglet) {
        // New multi-record write when the caller supplies the richer
        // Hunt payload (#73); legacy single-record LNURL write stays
        // as the fallback so we don't break any pre-#73 call-site.
        if (huntPayload) {
          await writeHuntTagToTag({ ...huntPayload, onTagDetected });
        } else {
          await writeLnurlToTag(lnurl, onTagDetected);
        }
      } else {
        await writeNpubToTag(npub, onTagDetected);
      }
      if (mountedRef.current) {
        setState('success');
        onWritten?.();
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
      snapPoints={snapPoints}
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
                ? 'This writes the prize link onto the tag and locks it so no one can overwrite it. Keep the Piglet still against the phone until it confirms.'
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
            <Text style={styles.instruction}>Successfully written!</Text>
            <Text style={styles.description}>
              {isPiglet
                ? 'The prize link is on the tag and locked. Hide the Piglet, then drop a pin so finders can hunt for it.'
                : `${displayName}'s npub has been written to the NFC tag. Anyone can now tap this tag to view the profile.`}
            </Text>
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
  });

export default NfcWriteSheet;
