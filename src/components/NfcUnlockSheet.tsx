import { createNfcUnlockSheetStyles as createStyles } from '../styles/NfcUnlockSheet.styles';
import BrandedSpinner from './BrandedSpinner';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, BackHandler, Platform } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { BottomSheetModal } from './AccessibleBottomSheetModal';
import { Unlock, AlertCircle } from 'lucide-react-native';
import { cancelNfcOperation, isNfcEnabled, unlockHuntTag } from '../services/nfcService';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { hexToBytes } from '../utils/nfc/ntag21xLock';

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
  const t = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [state, setState] = useState<UnlockState>('ready');
  const [errorMessage, setErrorMessage] = useState('');
  // No explicit snapPoints — gorhom v5 defaults `enableDynamicSizing`
  // to true, sizing the sheet to its content. Project rule: no
  // hardcoded heights for bottom sheets.
  const sheetRef = useRef<BottomSheetModal>(null);
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
            ? t('nfcUnlockSheet.nfcOffAndroid')
            : t('nfcUnlockSheet.nfcOffIos'),
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
        setErrorMessage(
          err instanceof Error ? err.message : t('nfcUnlockSheet.unlockFailedGeneric'),
        );
      }
    }
  }, [onUnlocked, packHex, pwdHex, tagUid, t]);

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
      onDismiss={handleClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.content}>
        <Text style={styles.title}>{t('nfcUnlockSheet.title')}</Text>

        {state === 'ready' && (
          <View style={styles.stateContainer}>
            <View style={styles.iconContainer}>
              <Unlock size={64} color={colors.brandPink} strokeWidth={2} />
            </View>
            <Text style={styles.instruction}>{t('nfcUnlockSheet.holdPiglet')}</Text>
            <Text style={styles.description}>{t('nfcUnlockSheet.readyDesc')}</Text>
            <BrandedSpinner size="small" style={styles.waitingIndicator} />
            <Text style={styles.waitingText}>{t('nfcUnlockSheet.waitingForTag')}</Text>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleClose}
              accessibilityLabel={t('nfcUnlockSheet.cancelUnlock')}
              testID="nfc-unlock-cancel"
            >
              <Text style={styles.cancelButtonText}>{t('nfcUnlockSheet.cancel')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {state === 'unlocking' && (
          <View style={styles.stateContainer}>
            <BrandedSpinner size="large" />
            <Text style={styles.instruction}>{t('nfcUnlockSheet.unlockingTag')}</Text>
          </View>
        )}

        {state === 'success' && (
          <View style={styles.stateContainer}>
            <View style={[styles.iconContainer, styles.successIcon]}>
              <Text style={styles.checkmark}>&#10003;</Text>
            </View>
            <Text style={styles.instruction}>{t('nfcUnlockSheet.tagUnlocked')}</Text>
            <Text style={styles.description}>{t('nfcUnlockSheet.successDesc')}</Text>
            <TouchableOpacity
              style={styles.doneButton}
              onPress={handleClose}
              accessibilityLabel={t('nfcUnlockSheet.closeSheet')}
              testID="nfc-unlock-done"
            >
              <Text style={styles.doneButtonText}>{t('nfcUnlockSheet.done')}</Text>
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
            <Text style={styles.instruction}>{t('nfcUnlockSheet.unlockFailed')}</Text>
            <Text style={styles.description}>{errorMessage}</Text>
            <View style={styles.errorButtons}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => startUnlock()}
                accessibilityLabel={t('nfcUnlockSheet.retryUnlock')}
                testID="nfc-unlock-retry"
              >
                <Text style={styles.retryButtonText}>{t('nfcUnlockSheet.tryAgain')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleClose}
                accessibilityLabel={t('nfcUnlockSheet.cancelUnlock')}
                testID="nfc-unlock-error-cancel"
              >
                <Text style={styles.cancelButtonText}>{t('nfcUnlockSheet.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
};

export default NfcUnlockSheet;
