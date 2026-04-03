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
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { colors } from '../styles/theme';
import { useNostr } from '../contexts/NostrContext';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const EditProfileSheet: React.FC<Props> = ({ visible, onClose }) => {
  const { profile, publishProfile } = useNostr();
  const [displayName, setDisplayName] = useState('');
  const [pictureUrl, setPictureUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [lud16, setLud16] = useState('');
  const [about, setAbout] = useState('');
  const [saving, setSaving] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const sheetRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<any>(null);
  const snapPoints = useMemo(() => ['85%'], []);

  useEffect(() => {
    if (visible) {
      setDisplayName(profile?.displayName || profile?.name || '');
      setPictureUrl(profile?.picture || '');
      setBannerUrl(profile?.banner || '');
      setLud16(profile?.lud16 || '');
      setAbout(profile?.about || '');
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible, profile]);

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

  const handleSave = async () => {
    setSaving(true);
    const success = await publishProfile({
      display_name: displayName.trim() || undefined,
      name: displayName.trim() || undefined,
      picture: pictureUrl.trim() || undefined,
      banner: bannerUrl.trim() || undefined,
      lud16: lud16.trim() || undefined,
      about: about.trim() || undefined,
    });
    setSaving(false);
    if (success) {
      Alert.alert('Profile Updated', 'Your Nostr profile has been published.');
      onClose();
    } else {
      Alert.alert('Error', 'Failed to publish profile. Please try again.');
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
        <Text style={styles.title}>Edit Profile</Text>

        <Text style={styles.label}>Display Name</Text>
        <BottomSheetTextInput
          style={styles.input}
          placeholder="Your name"
          placeholderTextColor={colors.textSupplementary}
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          autoCorrect={false}
          accessibilityLabel="Display name"
          testID="edit-display-name"
        />

        <Text style={styles.label}>Profile Picture URL</Text>
        <BottomSheetTextInput
          style={styles.input}
          placeholder="https://example.com/avatar.jpg"
          placeholderTextColor={colors.textSupplementary}
          value={pictureUrl}
          onChangeText={setPictureUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Profile picture URL"
          testID="edit-picture-url"
        />

        <Text style={styles.label}>Banner Image URL</Text>
        <BottomSheetTextInput
          style={styles.input}
          placeholder="https://example.com/banner.jpg"
          placeholderTextColor={colors.textSupplementary}
          value={bannerUrl}
          onChangeText={setBannerUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          accessibilityLabel="Banner image URL"
          testID="edit-banner-url"
        />

        <Text style={styles.label}>Lightning Address</Text>
        <BottomSheetTextInput
          style={styles.input}
          placeholder="you@wallet.com"
          placeholderTextColor={colors.textSupplementary}
          value={lud16}
          onChangeText={setLud16}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          accessibilityLabel="Lightning address"
          testID="edit-lud16"
        />

        <Text style={styles.label}>About</Text>
        <BottomSheetTextInput
          style={[styles.input, styles.textArea]}
          placeholder="Tell the world about yourself..."
          placeholderTextColor={colors.textSupplementary}
          value={about}
          onChangeText={setAbout}
          multiline
          numberOfLines={3}
          accessibilityLabel="About"
          testID="edit-about"
        />

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.disabled]}
          onPress={handleSave}
          disabled={saving}
          accessibilityLabel="Save profile"
          testID="save-profile"
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveButtonText}>Save Profile</Text>
          )}
        </TouchableOpacity>
      </BottomSheetScrollView>
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
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textHeader,
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSupplementary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: colors.textBody,
    fontWeight: '500',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveButton: {
    backgroundColor: colors.brandPink,
    height: 52,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.5,
  },
});

export default EditProfileSheet;
