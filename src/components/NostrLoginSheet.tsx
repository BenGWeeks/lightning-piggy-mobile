import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  BackHandler,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import { colors } from '../styles/theme';
import { useNostr } from '../contexts/NostrContext';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const NostrLoginSheet: React.FC<Props> = ({ visible, onClose }) => {
  const { loginWithNsec, loginWithAmber, isLoggingIn } = useNostr();
  const [nsecInput, setNsecInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['55%'], []);

  useEffect(() => {
    if (visible) {
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

  const handleLogin = async () => {
    setError(null);
    const result = await loginWithNsec(nsecInput);
    if (result.success) {
      setNsecInput('');
      onClose();
    } else {
      setError(result.error || 'Login failed');
    }
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
      snapPoints={snapPoints}
      onDismiss={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.content}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.inner}>
            <Text style={styles.title}>Connect Nostr</Text>
            <Text style={styles.subtitle}>
              Enter your private key to connect your Nostr identity.
            </Text>

            <TextInput
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
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.loginButton, (!nsecInput.trim() || isLoggingIn) && styles.disabled]}
              onPress={handleLogin}
              disabled={!nsecInput.trim() || isLoggingIn}
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
              >
                <Text style={styles.amberButtonText}>Use Amber Signer</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableWithoutFeedback>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleIndicator: {
    backgroundColor: colors.divider,
    width: 40,
  },
  content: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
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
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: colors.textBody,
    fontWeight: '500',
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
});

export default NostrLoginSheet;
