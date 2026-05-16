import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Unlock, AlertCircle } from 'lucide-react-native';
import { cancelNfcOperation, isNfcEnabled, unlockHuntTag } from '../services/nfcService';
import { useThemeColors } from '../contexts/ThemeContext';
import { hexToBytes } from '../utils/nfc/ntag21xLock';
import type { Palette } from '../styles/palettes';

// Bottom-sheet companion to NfcWriteSheet that drives the reversible-
// lock unlock flow. The hider opens this from the PIN card on step 6
// of the Hide-a-Piglet wizard (either fresh post-write, or after
// re-entering via Edit), taps the locked tag against the back of the
// phone, and we send PWD_AUTH + flip AUTH0 back to 0xFF so anyone can
// rewrite the chip again. An earlier design placed this affordance on
// My Piglets → Piglet detail; that surface was explicitly dropped on
// user feedback ("doesn't need to be on the actual Geocache page").
// Issue #567.

interface Props {
  visible: boolean;
  onClose: () => void;
  // Stored secrets for the tag the hider is trying to unlock — taken
  // from the matching HiddenPiggy.nfcLock record. We don't ask the
  // hider to retype the PIN because they're authorised by the fact
  // that they're signed into the same wallet that hid the Piggy.
  pwdHex: string;
  packHex: string;
  // UID of the tag the secrets correspond to. Compared against the
  // detected tag's UID before any PWD_AUTH frame is sent — defends
  // against accidentally unlocking a *different* tag whose PWD
  // happens to collide. Issue #567 storage-contract guarantee.
  tagUid: string;
  // Fires once the unlock succeeds — caller usually clears the
  // `nfcLock` field on the matching HiddenPiggy.
  onUnlocked?: () => void;
}

type UnlockState = 'ready' | 'unlocking' | 'success' | 'error';

const NfcUnlockSheet: React.FC<Props> = ({
  visible,
  onClose,
  pwdHex,
  packHex,
  tagUid,
  onUnlocked,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [state, setState] = useState<UnlockState>('ready');
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

  const startUnlock = useCallback(async () => {
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
      // Decode hex straight before we transceive — surfaces "PIN format
      // corrupt" errors before the user taps the tag, not mid-write.
      const pwd = hexToBytes(pwdHex, 4);
      const expectedPack = hexToBytes(packHex, 2);
      await unlockHuntTag({
        pwd,
        expectedPack,
        expectedUid: tagUid,
        onTagDetected: () => mountedRef.current && setState('unlocking'),
      });
      if (mountedRef.current) {
        setState('success');
        onUnlocked?.();
      }
    } catch (err) {
      if (mountedRef.current) {
        setState('error');
        setErrorMessage(err instanceof Error ? err.message : 'Failed to unlock tag');
      }
    }
  }, [onUnlocked, packHex, pwdHex, tagUid]);

  useEffect(() => {
    if (visible) {
      setState('ready');
      setErrorMessage('');
      sheetRef.current?.present();
      startUnlock();
    } else {
      sheetRef.current?.dismiss();
      cancelNfcOperation();
      setState('ready');
      setErrorMessage('');
    }
  }, [visible, startUnlock]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      cancelNfcOperation();
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

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
        <Text style={styles.title}>Unlock the Piglet tag</Text>

        {state === 'ready' && (
          <View style={styles.stateContainer}>
            <View style={styles.iconContainer}>
              <Unlock size={64} color={colors.brandPink} strokeWidth={2} />
            </View>
            <Text style={styles.instruction}>Hold the Piglet to the back of your phone</Text>
            <Text style={styles.description}>
              This sends the PIN to the tag and removes the rewrite lock. After unlocking, the tag
              accepts a fresh write from any NFC writer.
            </Text>
            <ActivityIndicator
              size="small"
              color={colors.brandPink}
              style={styles.waitingIndicator}
            />
            <Text style={styles.waitingText}>Waiting for the tag…</Text>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleClose}
              accessibilityLabel="Cancel NFC unlock"
              testID="nfc-unlock-cancel"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'unlocking' && (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={colors.brandPink} />
            <Text style={styles.instruction}>Unlocking tag…</Text>
          </View>
        )}

        {state === 'success' && (
          <View style={styles.stateContainer}>
            <View style={[styles.iconContainer, styles.successIcon]}>
              <Text style={styles.checkmark}>&#10003;</Text>
            </View>
            <Text style={styles.instruction}>Tag unlocked</Text>
            <Text style={styles.description}>
              The tag is rewriteable again. Run the Hide-a-Piglet wizard if you want to repoint it
              to a new Piggy.
            </Text>
            <TouchableOpacity
              style={styles.doneButton}
              onPress={handleClose}
              accessibilityLabel="Close NFC unlock sheet"
              testID="nfc-unlock-done"
            >
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'error' && (
          <View style={styles.stateContainer}>
            <View style={[styles.iconContainer, styles.errorIcon]}>
              <Unlock size={64} color={colors.red} strokeWidth={2} />
              <View style={styles.errorBadge}>
                <AlertCircle size={26} color={colors.red} strokeWidth={2.5} />
              </View>
            </View>
            <Text style={styles.instruction}>Unlock failed</Text>
            <Text style={styles.description}>{errorMessage}</Text>
            <View style={styles.errorButtons}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => startUnlock()}
                accessibilityLabel="Retry NFC unlock"
                testID="nfc-unlock-retry"
              >
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleClose}
                accessibilityLabel="Cancel NFC unlock"
                testID="nfc-unlock-error-cancel"
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
    handleIndicator: { backgroundColor: colors.divider, width: 40 },
    content: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 40,
    },
    title: { fontSize: 18, fontWeight: '700', color: colors.textHeader, marginBottom: 24 },
    stateContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
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
    errorIcon: { backgroundColor: colors.redLight },
    checkmark: { fontSize: 48, color: colors.green, fontWeight: '700' },
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
    waitingText: { fontSize: 13, color: colors.textSupplementary, marginBottom: 24 },
    cancelButton: {
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.divider,
    },
    cancelButtonText: { fontSize: 15, fontWeight: '600', color: colors.textSupplementary },
    doneButton: {
      paddingHorizontal: 48,
      paddingVertical: 14,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    doneButtonText: { fontSize: 15, fontWeight: '700', color: colors.white },
    errorButtons: { flexDirection: 'row', gap: 12 },
    retryButton: {
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.brandPink,
    },
    retryButtonText: { fontSize: 15, fontWeight: '700', color: colors.white },
  });

export default NfcUnlockSheet;
