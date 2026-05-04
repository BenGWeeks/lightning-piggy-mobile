import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
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
} from '@gorhom/bottom-sheet';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

interface Props {
  visible: boolean;
  onClose: () => void;
  onAdd: (npubOrHex: string) => Promise<boolean>;
}

const AddFriendSheet: React.FC<Props> = ({ visible, onClose, onAdd }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
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
      setScanError('Invalid npub or public key');
    }
  };

  const handleScanMode = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Permission needed', 'Camera permission is required to scan QR codes.');
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
        <Text style={styles.title}>Add Nostr Friend</Text>

        {/* Mode toggle */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleTab, mode === 'paste' && styles.toggleTabActive]}
            onPress={() => setMode('paste')}
          >
            <Text style={[styles.toggleText, mode === 'paste' && styles.toggleTextActive]}>
              Paste npub
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleTab, mode === 'scan' && styles.toggleTabActive]}
            onPress={handleScanMode}
          >
            <Text style={[styles.toggleText, mode === 'scan' && styles.toggleTextActive]}>
              Scan QR
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'paste' ? (
          <View style={styles.pasteContent}>
            <View style={styles.inputRow}>
              {/*
                Plain RN TextInput rather than BottomSheetTextInput. Issue
                #146: Maestro's `inputText` drops characters when typing
                into @gorhom/bottom-sheet's BottomSheetTextInput under the
                New Architecture (testID lands on the wrapper View, not
                the native EditText, so the synthetic keystrokes never
                advance the JS event path). The npub input is exercised
                by `tests/e2e/test-follow-unfollow.yaml`, where a 63-char
                bech32 string would otherwise arrive truncated and trip
                "Invalid public key format". Keyboard tracking for the
                sheet is preserved by its `keyboardBehavior="interactive"`
                + `android_keyboardInputMode="adjustResize"` props above.
              */}
              <TextInput
                style={styles.input}
                placeholder="npub1..."
                placeholderTextColor={colors.textSupplementary}
                value={inputValue}
                onChangeText={setInputValue}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="npub input"
                testID="npub-input"
              />
              <TouchableOpacity style={styles.pasteButton} onPress={handlePaste}>
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
              style={[
                styles.addButton,
                (!inputValue.trim() || loading) && styles.addButtonDisabled,
              ]}
              onPress={handleAdd}
              disabled={!inputValue.trim() || loading}
              accessibilityLabel="Add Friend"
              testID="add-friend-submit"
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.addButtonText}>Add Friend</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.scanContent}>
            {loading ? (
              <View style={styles.scanLoading}>
                <ActivityIndicator size="large" color={colors.brandPink} />
                <Text style={styles.scanLoadingText}>Adding friend...</Text>
              </View>
            ) : scanError ? (
              <View style={styles.scanLoading}>
                <Text style={styles.scanErrorText}>{scanError}</Text>
                <TouchableOpacity
                  style={styles.scanAgainButton}
                  onPress={() => {
                    setScanned(false);
                    setScanError(null);
                  }}
                >
                  <Text style={styles.scanAgainText}>Scan Again</Text>
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
      alignItems: 'center',
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 40,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 16,
    },
    toggleRow: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderRadius: 10,
      padding: 3,
      marginBottom: 20,
    },
    toggleTab: {
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 8,
    },
    toggleTabActive: {
      backgroundColor: colors.white,
    },
    toggleText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    toggleTextActive: {
      color: colors.brandPink,
    },
    pasteContent: {
      width: '100%',
      gap: 16,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 10,
      paddingHorizontal: 12,
      gap: 8,
    },
    input: {
      flex: 1,
      paddingVertical: 14,
      fontSize: 15,
      color: colors.textHeader,
      fontWeight: '500',
    },
    pasteButton: {
      padding: 8,
    },
    addButton: {
      backgroundColor: colors.brandPink,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
    },
    addButtonDisabled: {
      opacity: 0.5,
    },
    addButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    scanContent: {
      width: '100%',
      alignItems: 'center',
    },
    cameraContainer: {
      width: 250,
      height: 250,
      borderRadius: 16,
      overflow: 'hidden',
    },
    camera: {
      width: 250,
      height: 250,
    },
    scanLoading: {
      width: 250,
      height: 250,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 12,
    },
    scanLoadingText: {
      fontSize: 14,
      color: colors.textSupplementary,
    },
    scanErrorText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textHeader,
      textAlign: 'center',
    },
    scanAgainButton: {
      backgroundColor: colors.brandPink,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
    },
    scanAgainText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
  });

export default AddFriendSheet;
