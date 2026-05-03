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
} from 'react-native';
import { Alert } from './BrandedAlert';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import Svg, { Path, Circle } from 'react-native-svg';
import { UserRound } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { useNostr } from '../contexts/NostrContext';
import { stripImageMetadata, uploadImage } from '../services/imageUploadService';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const EditProfileSheet: React.FC<Props> = ({ visible, onClose }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { profile, publishProfile, signEvent, isLoggedIn } = useNostr();
  const [displayName, setDisplayName] = useState('');
  const [pictureUrl, setPictureUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [lud16, setLud16] = useState('');
  const [about, setAbout] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const sheetRef = useRef<BottomSheetModal>(null);
  const scrollRef = useRef<any>(null);
  // No explicit snapPoints — content-height only, not user-draggable.

  // Populate fields ONCE per open. Keying on `visible` alone: if `profile`
  // were in the deps, every NostrContext re-render (contact sync, cache
  // refresh, relay reconnect) would re-fire this effect and stomp the
  // user's in-progress edits — symptom: typing into Display Name /
  // Lightning Address / About makes characters "disappear" on every
  // context tick. See the matching fix in WalletSettingsSheet.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const pickAndUpload = async (type: 'picture' | 'banner'): Promise<void> => {
    const setUploading = type === 'picture' ? setUploadingPicture : setUploadingBanner;
    const setUrl = type === 'picture' ? setPictureUrl : setBannerUrl;
    const aspect: [number, number] = type === 'picture' ? [1, 1] : [3, 1];

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect,
      quality: 1,
      // `stripImageMetadata` re-encodes the picked image through
      // expo-image-manipulator at `compress: 0.9` and produces fresh
      // base64 (see #145). Picking at quality 1 here avoids a double
      // JPEG encode.
      // `base64: true` feeds the GIF passthrough branch in
      // stripImageMetadata (expo-image-manipulator has no animated
      // output). In practice the OS crop editor from `allowsEditing`
      // flattens GIFs to JPEG before we see them, so the GIF branch
      // rarely fires here — set for consistency with chat paths.
      base64: true,
    });

    if (result.canceled || !result.assets?.[0]) return;

    setUploading(true);
    try {
      const scrubbed = await stripImageMetadata(result.assets[0].uri, result.assets[0].base64);
      const url = await uploadImage(scrubbed.uri, isLoggedIn ? signEvent : null, scrubbed.base64);
      setUrl(url);
    } catch (error) {
      Alert.alert('Upload Failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setUploading(false);
    }
  };

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
        <Text style={styles.safetyTip}>
          Tip: You don't need to use your real name or photo for your profile.
        </Text>

        {/* Banner image */}
        <Text style={styles.label}>Banner Image</Text>
        <TouchableOpacity
          style={styles.bannerPicker}
          onPress={() => pickAndUpload('banner')}
          disabled={uploadingBanner}
          accessibilityLabel="Change banner image"
          testID="edit-banner-picker"
        >
          {uploadingBanner ? (
            <ActivityIndicator color={colors.brandPink} />
          ) : bannerUrl ? (
            <Image source={{ uri: bannerUrl }} style={styles.bannerPreview} cachePolicy="none" />
          ) : (
            <View style={styles.placeholderContent}>
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M21 15l-5-5L5 21"
                  stroke={colors.textSupplementary}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Path
                  d="M3 3h18v18H3z"
                  stroke={colors.textSupplementary}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <Circle cx="8.5" cy="8.5" r="1.5" fill={colors.textSupplementary} />
              </Svg>
              <Text style={styles.placeholderText}>Tap to choose banner</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Profile picture */}
        <Text style={styles.label}>Profile Picture</Text>
        <TouchableOpacity
          style={styles.avatarPicker}
          onPress={() => pickAndUpload('picture')}
          disabled={uploadingPicture}
          accessibilityLabel="Change profile picture"
          testID="edit-picture-picker"
        >
          {uploadingPicture ? (
            <ActivityIndicator color={colors.brandPink} />
          ) : pictureUrl ? (
            <Image source={{ uri: pictureUrl }} style={styles.avatarPreview} cachePolicy="none" />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <UserRound size={36} color={colors.textBody} strokeWidth={1.75} />
              <Text style={styles.avatarPlaceholderText}>Tap</Text>
            </View>
          )}
        </TouchableOpacity>

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
    safetyTip: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginBottom: 16,
      fontStyle: 'italic',
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
    bannerPicker: {
      height: 100,
      borderRadius: 12,
      backgroundColor: colors.background,
      overflow: 'hidden',
      justifyContent: 'center',
      alignItems: 'center',
    },
    bannerPreview: {
      width: '100%',
      height: '100%',
    },
    avatarPicker: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.background,
      overflow: 'hidden',
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'center',
    },
    avatarPreview: {
      width: 80,
      height: 80,
      borderRadius: 40,
    },
    avatarPlaceholder: {
      justifyContent: 'center',
      alignItems: 'center',
      gap: 2,
      width: 80,
      height: 80,
    },
    avatarPlaceholderText: {
      fontSize: 10,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
    placeholderContent: {
      justifyContent: 'center',
      alignItems: 'center',
      gap: 4,
    },
    placeholderText: {
      fontSize: 12,
      color: colors.textSupplementary,
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
