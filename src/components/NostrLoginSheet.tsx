import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  BackHandler,
  Keyboard,
  Alert,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { useNostr } from '../contexts/NostrContext';
import * as nostrService from '../services/nostrService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Mode = 'login' | 'create' | 'backup';

const NostrLoginSheet: React.FC<Props> = ({ visible, onClose }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { loginWithNsec, loginWithAmber, publishProfile, isLoggingIn } = useNostr();
  const [nsecInput, setNsecInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [mode, setMode] = useState<Mode>('login');
  const [newName, setNewName] = useState('');
  const [generatedNsec, setGeneratedNsec] = useState('');
  const [creating, setCreating] = useState(false);
  const sheetRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<any>(null);
  // No explicit snapPoints — content-height only, not user-draggable.

  useEffect(() => {
    if (visible) {
      setMode('login');
      setNewName('');
      setGeneratedNsec('');
      setError(null);
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

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 100);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleLogin = async () => {
    setError(null);
    const result = await loginWithNsec(nsecInput.trim());
    if (result.success) {
      setNsecInput('');
      onClose();
    } else {
      setError(result.error || 'Login failed');
    }
  };

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setNsecInput(text.trim());
      setError(null);
    }
  };

  const handleCreate = () => {
    const { nsec } = nostrService.generateKeypair();
    setGeneratedNsec(nsec);
    setMode('create');
  };

  const handleFinishCreate = async () => {
    if (!newName.trim()) {
      setError('Please enter a display name');
      return;
    }
    setCreating(true);
    setError(null);

    // Login with the generated nsec first
    const result = await loginWithNsec(generatedNsec);
    if (!result.success) {
      setError(result.error || 'Failed to create account');
      setCreating(false);
      return;
    }

    // Publish initial profile with display name (best-effort, don't block)
    const published = await publishProfile({
      display_name: newName.trim(),
      name: newName.trim(),
    });
    if (!published) {
      // Profile publish failed but account is created — user can edit later
      if (__DEV__) console.warn('Initial profile publish failed');
    }

    // Show backup screen
    setMode('backup');
    setCreating(false);
  };

  const handleCopyNsec = async () => {
    await Clipboard.setStringAsync(generatedNsec);
    Alert.alert('Copied', 'Your private key has been copied. Store it somewhere safe!');
  };

  const handleDone = () => {
    setNsecInput('');
    onClose();
  };

  const handleAmber = async () => {
    setError(null);
    const result = await loginWithAmber();
    if (result.success) {
      onClose();
    } else {
      setError(result.error || 'Amber login failed');
    }
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
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={{ paddingBottom: keyboardHeight > 0 ? keyboardHeight + 80 : 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {mode === 'login' && (
          <>
            <Text style={styles.title}>Connect Nostr</Text>
            <Text style={styles.subtitle}>
              Enter your private key to connect your Nostr identity.
            </Text>

            <View style={styles.inputRow}>
              <BottomSheetTextInput
                style={styles.input}
                placeholder="nsec1..."
                placeholderTextColor={colors.textSupplementary}
                value={nsecInput}
                onChangeText={(text) => {
                  setNsecInput(text);
                  setError(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!isLoggingIn}
                accessibilityLabel="nsec input"
                testID="nsec-input"
              />
              <TouchableOpacity
                style={styles.pasteButton}
                onPress={handlePaste}
                accessibilityLabel="Paste"
                testID="paste-nsec"
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                    stroke={colors.textSupplementary}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                  <Path
                    d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Z"
                    stroke={colors.textSupplementary}
                    strokeWidth={2}
                  />
                </Svg>
              </TouchableOpacity>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.loginButton, (!nsecInput.trim() || isLoggingIn) && styles.disabled]}
              onPress={handleLogin}
              disabled={!nsecInput.trim() || isLoggingIn}
              accessibilityLabel="Login"
              testID="login-button"
            >
              {isLoggingIn ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.loginButtonText}>Login</Text>
              )}
            </TouchableOpacity>

            {Platform.OS === 'android' && (
              <TouchableOpacity
                style={styles.amberButton}
                onPress={handleAmber}
                disabled={isLoggingIn}
                accessibilityLabel="Use Amber Signer"
                testID="amber-button"
              >
                <Text style={styles.amberButtonText}>Use Amber Signer</Text>
              </TouchableOpacity>
            )}

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.createButton}
              onPress={handleCreate}
              accessibilityLabel="Create a Nostr Account"
              testID="create-account-button"
            >
              <Text style={styles.createButtonText}>Create a Nostr Account</Text>
            </TouchableOpacity>
          </>
        )}

        {mode === 'create' && (
          <>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Choose a display name for your new Nostr identity.</Text>
            <Text style={styles.safetyTip}>
              Tip: You don't need to use your real name or photo.
            </Text>

            <Text style={styles.fieldLabel}>Display Name</Text>
            <BottomSheetTextInput
              style={styles.createInput}
              placeholder="Your name"
              placeholderTextColor={colors.textSupplementary}
              value={newName}
              onChangeText={(text) => {
                setNewName(text);
                setError(null);
              }}
              autoCapitalize="words"
              autoCorrect={false}
              accessibilityLabel="Display name"
              testID="create-name-input"
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.loginButton, creating && styles.disabled]}
              onPress={handleFinishCreate}
              disabled={creating}
              accessibilityLabel="Create Account"
              testID="create-account-submit"
            >
              {creating ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.loginButtonText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.backLink} onPress={() => setMode('login')}>
              <Text style={styles.backLinkText}>Back to login</Text>
            </TouchableOpacity>
          </>
        )}

        {mode === 'backup' && (
          <>
            <Text style={styles.title}>Back Up Your Key</Text>
            <Text style={styles.warningText}>
              Save your private key somewhere safe. If you lose it, you cannot recover your account.
            </Text>

            <Text style={styles.fieldLabel}>Your Private Key (nsec)</Text>
            <View style={styles.nsecDisplay}>
              <Text style={styles.nsecText} selectable>
                {generatedNsec}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.copyButton}
              onPress={handleCopyNsec}
              accessibilityLabel="Copy private key"
              testID="copy-nsec"
            >
              <Text style={styles.copyButtonText}>Copy to Clipboard</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.loginButton}
              onPress={handleDone}
              accessibilityLabel="Done"
              testID="backup-done"
            >
              <Text style={styles.loginButtonText}>I've Saved My Key</Text>
            </TouchableOpacity>
          </>
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
      flex: 1,
      paddingHorizontal: 24,
      paddingTop: 8,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      marginBottom: 20,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingHorizontal: 12,
    },
    input: {
      flex: 1,
      paddingVertical: 16,
      fontSize: 16,
      color: colors.textBody,
      fontWeight: '500',
    },
    pasteButton: {
      padding: 8,
    },
    error: {
      color: colors.red,
      fontSize: 13,
      marginTop: 8,
    },
    loginButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 16,
    },
    loginButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    disabled: {
      opacity: 0.5,
    },
    amberButton: {
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 12,
      borderWidth: 2,
      borderColor: colors.brandPink,
    },
    amberButtonText: {
      color: colors.brandPink,
      fontSize: 16,
      fontWeight: '700',
    },
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 20,
      marginBottom: 12,
      gap: 12,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.divider,
    },
    dividerText: {
      fontSize: 13,
      color: colors.textSupplementary,
      fontWeight: '500',
    },
    createButton: {
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    createButtonText: {
      color: colors.textHeader,
      fontSize: 16,
      fontWeight: '700',
    },
    safetyTip: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginBottom: 12,
      fontStyle: 'italic',
    },
    fieldLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
      marginBottom: 6,
    },
    createInput: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 16,
      color: colors.textBody,
      fontWeight: '500',
    },
    backLink: {
      alignItems: 'center',
      marginTop: 16,
    },
    backLinkText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '600',
    },
    warningText: {
      fontSize: 14,
      color: colors.red,
      marginBottom: 20,
      lineHeight: 20,
    },
    nsecDisplay: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
    },
    nsecText: {
      fontSize: 13,
      color: colors.textBody,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      lineHeight: 18,
    },
    copyButton: {
      height: 44,
      borderRadius: 10,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 12,
      borderWidth: 2,
      borderColor: colors.brandPink,
    },
    copyButtonText: {
      color: colors.brandPink,
      fontSize: 14,
      fontWeight: '600',
    },
  });

export default NostrLoginSheet;
