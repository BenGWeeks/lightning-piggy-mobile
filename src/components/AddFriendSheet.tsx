import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  BackHandler,
  ActivityIndicator,
  Keyboard,
  Platform,
} from 'react-native';
import { Alert } from './BrandedAlert';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createAddFriendSheetStyles } from '../styles/AddFriendSheet.styles';

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdd: (npubOrHex: string) => Promise<boolean>;
}

const AddFriendSheet: React.FC<Props> = ({ visible, onClose, onAdd }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createAddFriendSheetStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const [mode, setMode] = useState<'paste' | 'scan'>('paste');
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setInputValue('');
      setMode('paste');
      setScanned(false);
      setScanError(null);
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
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

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setInputValue(text.trim());
  };

  const handleAdd = async () => {
    if (!inputValue.trim() || loading) return;
    setLoading(true);
    const success = await onAdd(inputValue.trim());
    setLoading(false);
    if (success) onClose();
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned || loading) return;
    setScanned(true);
    setScanError(null);
    setLoading(true);
    const success = await onAdd(data.trim());
    setLoading(false);
    if (success) {
      onClose();
    } else {
      setScanError(t('addFriendSheet.invalidNpub'));
    }
  };

  const handleScanMode = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          t('addFriendSheet.permissionNeededTitle'),
          t('addFriendSheet.permissionNeededMessage'),
        );
        return;
      }
    }
    setMode('scan');
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 40 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t('addFriendSheet.title')}</Text>

        {/* Mode toggle */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            accessibilityRole="tab"
            style={[styles.toggleTab, mode === 'paste' && styles.toggleTabActive]}
            onPress={() => setMode('paste')}
            accessibilityLabel={t('addFriendSheet.pasteTab')}
            accessibilityState={{ selected: mode === 'paste' }}
            testID="add-friend-tab-paste"
          >
            <Text style={[styles.toggleText, mode === 'paste' && styles.toggleTextActive]}>
              {t('addFriendSheet.pasteTab')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="tab"
            style={[styles.toggleTab, mode === 'scan' && styles.toggleTabActive]}
            onPress={handleScanMode}
            accessibilityLabel={t('addFriendSheet.scanTab')}
            accessibilityState={{ selected: mode === 'scan' }}
            testID="add-friend-tab-scan"
          >
            <Text style={[styles.toggleText, mode === 'scan' && styles.toggleTextActive]}>
              {t('addFriendSheet.scanTab')}
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'paste' ? (
          <View style={styles.pasteContent}>
            <View style={styles.inputRow}>
              <BottomSheetTextInput
                style={styles.input}
                placeholder="npub1..."
                placeholderTextColor={colors.textSupplementary}
                value={inputValue}
                onChangeText={setInputValue}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={t('addFriendSheet.npubInputA11y')}
                testID="npub-input"
              />
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.pasteButton}
                onPress={handlePaste}
                accessibilityLabel={t('addFriendSheet.pasteTab')}
                testID="add-friend-paste"
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                    stroke={colors.brandPink}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                  <Path
                    d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z"
                    stroke={colors.brandPink}
                    strokeWidth={2}
                  />
                </Svg>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: !inputValue.trim() || loading, busy: loading }}
              style={[
                styles.addButton,
                (!inputValue.trim() || loading) && styles.addButtonDisabled,
              ]}
              onPress={handleAdd}
              disabled={!inputValue.trim() || loading}
              accessibilityLabel={t('addFriendSheet.addFriend')}
              testID="add-friend-submit"
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.addButtonText}>{t('addFriendSheet.addFriend')}</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.scanContent}>
            {loading ? (
              <View style={styles.scanLoading}>
                <ActivityIndicator size="large" color={colors.brandPink} />
                <Text style={styles.scanLoadingText}>{t('addFriendSheet.addingFriend')}</Text>
              </View>
            ) : scanError ? (
              <View style={styles.scanLoading}>
                <Text style={styles.scanErrorText}>{scanError}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.scanAgainButton}
                  accessibilityLabel={t('addFriendSheet.scanAgain')}
                  testID="add-friend-scan-again"
                  onPress={() => {
                    setScanned(false);
                    setScanError(null);
                  }}
                >
                  <Text style={styles.scanAgainText}>{t('addFriendSheet.scanAgain')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.cameraContainer}>
                <CameraView
                  style={styles.camera}
                  facing="back"
                  onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                />
              </View>
            )}
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
};

export default AddFriendSheet;
