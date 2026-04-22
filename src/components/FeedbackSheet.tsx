import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  BackHandler,
  Alert,
  ActivityIndicator,
  Platform,
  Keyboard,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { colors } from '../styles/theme';
import type { SignerType } from '../types/nostr';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSend: (message: string) => Promise<{ success: boolean; error?: string }>;
  isLoggedIn: boolean;
  signerType: SignerType | null;
  onLoginPress: () => void;
  title?: string;
  subtitle?: string;
  initialMessage?: string;
  messagePrefix?: string;
  successTitle?: string;
  successMessage?: string;
}

const FeedbackSheet: React.FC<Props> = ({
  visible,
  onClose,
  onSend,
  isLoggedIn,
  signerType,
  onLoginPress,
  title = 'Send Feedback',
  subtitle = 'Your message will be sent as an encrypted Nostr DM to the Lightning Piggy team.',
  initialMessage = '',
  messagePrefix = '[Feedback]',
  successTitle = 'Feedback Sent',
  successMessage = 'Thank you for your feedback!',
}) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  // No explicit snapPoints — content-height only, not user-draggable.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Canonical keyboard-height tracking — mirrors SendSheet / NostrLoginSheet
  // / EditProfileSheet. Rule 5 of the "Bottom sheet doesn't slide up when
  // keyboard opens" checklist in docs/TROUBLESHOOTING.adoc.
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
  const [message, setMessage] = useState(initialMessage);
  const [sending, setSending] = useState(false);
  // Reset `message` only on hidden→visible transitions so async
  // `initialMessage` updates don't stomp the user's in-progress edits.
  const wasVisibleRef = useRef(false);
  const initialMessageRef = useRef(initialMessage);
  initialMessageRef.current = initialMessage;

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setMessage(initialMessageRef.current);
      setSending(false);
      sheetRef.current?.present();
    } else if (!visible && wasVisibleRef.current) {
      sheetRef.current?.dismiss();
    }
    wasVisibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => handler.remove();
  }, [visible, onClose]);

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed) return;

    setSending(true);
    try {
      const deviceInfo = `${Platform.OS} ${Platform.Version}`;
      const fullMessage = `${messagePrefix} ${trimmed}\n\n---\nDevice: ${deviceInfo}`;

      const result = await onSend(fullMessage);
      if (result.success) {
        Alert.alert(successTitle, successMessage, [{ text: 'OK', onPress: onClose }]);
      } else {
        Alert.alert('Error', result.error || 'Failed to send feedback.');
      }
    } catch {
      Alert.alert('Error', 'Failed to send feedback.');
    } finally {
      setSending(false);
    }
  };

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const canSend =
    isLoggedIn &&
    (signerType === 'nsec' || signerType === 'amber') &&
    message.trim().length > 0 &&
    !sending;

  return (
    <BottomSheetModal
      ref={sheetRef}
      onChange={handleSheetChange}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
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
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {!isLoggedIn ? (
          <View style={styles.loginPrompt}>
            <Text style={styles.loginText}>Sign in with Nostr to send feedback.</Text>
            <TouchableOpacity
              style={styles.loginButton}
              onPress={() => {
                onClose();
                onLoginPress();
              }}
              accessibilityLabel="Connect Nostr to send feedback"
              testID="feedback-login-button"
            >
              <Text style={styles.loginButtonText}>Connect Nostr</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <BottomSheetTextInput
              style={styles.textInput}
              placeholder="What's on your mind?"
              placeholderTextColor={colors.textSupplementary}
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={500}
              autoFocus
              accessibilityLabel="Feedback message"
              testID="feedback-input"
            />
            <Text style={styles.charCount}>{message.length}/500</Text>

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={!canSend}
                accessibilityLabel="Send feedback"
                testID="feedback-send-button"
              >
                {sending ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.sendButtonText}>Send</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleIndicator: {
    backgroundColor: colors.divider,
    width: 40,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textHeader,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSupplementary,
    textAlign: 'center',
  },
  textInput: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    fontSize: 14,
    color: colors.textBody,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  charCount: {
    fontSize: 12,
    color: colors.textSupplementary,
    textAlign: 'right',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  cancelButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  cancelButtonText: {
    color: colors.textBody,
    fontSize: 14,
    fontWeight: '600',
  },
  sendButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.brandPink,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  loginPrompt: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 20,
  },
  loginText: {
    fontSize: 14,
    color: colors.textBody,
    textAlign: 'center',
  },
  loginButton: {
    backgroundColor: colors.brandPink,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  loginButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
});

export default FeedbackSheet;
