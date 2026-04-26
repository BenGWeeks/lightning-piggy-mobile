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
import NfcIcon from './icons/NfcIcon';
import { writeNpubToTag, cancelNfcOperation, isNfcEnabled } from '../services/nfcService';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  visible: boolean;
  onClose: () => void;
  npub: string;
  displayName: string;
}

type WriteState = 'ready' | 'writing' | 'success' | 'error';

const NfcWriteSheet: React.FC<Props> = ({ visible, onClose, npub, displayName }) => {
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
      await writeNpubToTag(npub, () => {
        // Tag detected — show writing state
        if (mountedRef.current) setState('writing');
      });
      if (mountedRef.current) {
        setState('success');
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
        <Text style={styles.title}>Write to NFC</Text>

        {state === 'ready' && (
          <View style={styles.stateContainer}>
            <View style={styles.iconContainer}>
              <NfcIcon size={64} color={colors.brandPink} />
            </View>
            <Text style={styles.instruction}>Hold your phone against an NFC tag</Text>
            <Text style={styles.description}>
              This will write {displayName}&apos;s Nostr identity (npub) to the tag. Anyone with a
              Nostr-compatible app can tap the tag to view the profile.
            </Text>
            <Text style={styles.npubPreview} numberOfLines={1}>
              {npub.slice(0, 20)}...{npub.slice(-8)}
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
              {displayName}&apos;s npub has been written to the NFC tag. Anyone can now tap this tag
              to view the profile.
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
              <Text style={styles.errorMark}>!</Text>
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
      backgroundColor: '#FFEBEE',
    },
    checkmark: {
      fontSize: 48,
      color: colors.green,
      fontWeight: '700',
    },
    errorMark: {
      fontSize: 48,
      color: colors.red,
      fontWeight: '700',
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
