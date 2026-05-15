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
  readHuntTagPayload,
  cancelNfcOperation,
  isNfcEnabled,
  type HuntTagReadResult,
} from '../services/nfcService';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Cache coord we expect the tag to belong to. If the tag's `coord`
   * field doesn't match, the read is rejected with a "wrong Piglet"
   * error rather than silently letting the user claim against the
   * wrong cache. */
  expectedCoord: string;
  /** Fires once the tag is parsed and matches `expectedCoord`. The
   * parent uses the LNURL to navigate to HuntFoundScreen. */
  onRead: (result: HuntTagReadResult) => void;
}

type ReadState = 'ready' | 'reading' | 'success' | 'error';

/**
 * Finder-side NFC reader sheet. Counterpart to NfcWriteSheet — opens a
 * foreground reader session, parses the next Hide-a-Piglet tag, and
 * hands the parsed payload back via `onRead`. The bearer LNURL on
 * record 3 is what unlocks the prize claim, so this sheet is the only
 * gate between "tap the cache" and "21 sats in your wallet".
 */
const NfcReadSheet: React.FC<Props> = ({ visible, onClose, expectedCoord, onRead }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [state, setState] = useState<ReadState>('ready');
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

  const startRead = useCallback(async () => {
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
      const result = await readHuntTagPayload({
        onTagDetected: () => {
          if (mountedRef.current) setState('reading');
        },
      });
      // Sanity-gate the tag against the cache we're on. A tag pulled
      // from a different Piglet shouldn't silently claim against this
      // cache — that'd let a finder fork prize budgets across caches.
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
      if (mountedRef.current) {
        setState('success');
        onRead(result);
      }
    } catch (err) {
      if (mountedRef.current) {
        setState('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to read NFC tag');
      }
    }
  }, [expectedCoord, onRead]);

  useEffect(() => {
    if (visible) {
      setState('ready');
      setErrorMessage('');
      sheetRef.current?.present();
      startRead();
    } else {
      sheetRef.current?.dismiss();
      cancelNfcOperation();
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
        <Text style={styles.title}>Scan the Piglet</Text>

        {state === 'ready' && (
          <View style={styles.stateContainer}>
            <View style={styles.iconContainer}>
              <Nfc size={64} color={colors.brandPink} strokeWidth={2} />
            </View>
            <Text style={styles.instruction}>Hold the Piglet to the back of your phone</Text>
            <Text style={styles.description}>
              Reading the tag unlocks the prize link so the sats can land in your wallet.
            </Text>
            <ActivityIndicator
              size="small"
              color={colors.brandPink}
              style={styles.waitingIndicator}
            />
            <Text style={styles.waitingText}>Waiting for NFC tag...</Text>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleClose}
              accessibilityLabel="Cancel NFC read"
              testID="nfc-read-cancel"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'reading' && (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={colors.brandPink} />
            <Text style={styles.instruction}>Reading…</Text>
          </View>
        )}

        {state === 'success' && (
          <View style={styles.stateContainer}>
            <View style={[styles.iconContainer, styles.successIcon]}>
              <Text style={styles.checkmark}>&#10003;</Text>
            </View>
            <Text style={styles.instruction}>Tag read!</Text>
            <Text style={styles.description}>Opening the claim screen…</Text>
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
            <Text style={styles.instruction}>Read failed</Text>
            <Text style={styles.description}>{errorMessage}</Text>
            <View style={styles.errorButtons}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={handleRetry}
                accessibilityLabel="Retry NFC read"
                testID="nfc-read-retry"
              >
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleClose}
                accessibilityLabel="Cancel NFC read"
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
    successIcon: {
      backgroundColor: colors.greenLight,
    },
    errorIcon: {
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
