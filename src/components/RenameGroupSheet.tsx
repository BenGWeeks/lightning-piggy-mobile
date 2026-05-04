import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
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
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { useGroups } from '../contexts/GroupsContext';

interface Props {
  visible: boolean;
  groupId: string | null;
  onClose: () => void;
}

const RenameGroupSheet: React.FC<Props> = ({ visible, groupId, onClose }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { getGroup, renameGroup } = useGroups();
  const group = groupId ? getGroup(groupId) : undefined;
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<BottomSheetModal>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Canonical keyboard-height tracking — mirrors FeedbackSheet /
  // SendSheet / NostrLoginSheet. Rule 5 of the "Bottom sheet doesn't
  // slide up when keyboard opens" checklist in TROUBLESHOOTING.adoc.
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
      setName(group?.name ?? '');
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible, group?.name]);

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

  const handleSave = async () => {
    if (!groupId) return;
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Please enter a group name.');
      return;
    }
    if (trimmed === group?.name) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const ok = await renameGroup(groupId, trimmed);
      if (ok) {
        onClose();
      } else {
        Alert.alert('Error', 'Failed to rename group.');
      }
    } catch (err) {
      // AsyncStorage write failure. Without try/finally `saving` would
      // stick true and the Save button would stay disabled.
      if (__DEV__) console.warn('[RenameGroupSheet] renameGroup failed:', err);
      Alert.alert(
        'Could not rename group',
        'Failed to save the new name locally. Try again or restart the app.',
      );
    } finally {
      setSaving(false);
    }
  };

  const canSave = name.trim().length > 0 && !saving;

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
        <Text style={styles.title}>Rename Group</Text>
        <Text style={styles.label}>Group Name</Text>
        {/*
          Plain RN TextInput rather than BottomSheetTextInput. Issue #146:
          Maestro's `inputText` drops characters when typing into
          @gorhom/bottom-sheet's BottomSheetTextInput under the New
          Architecture (testID lands on the wrapper View, not the native
          EditText). Exercised by `tests/e2e/test-rename-group.yaml` and
          `tests/e2e/test-3way-group-rename-as-big.yaml`. Keyboard tracking
          for the sheet is preserved by the manual `Keyboard.addListener`
          + `keyboardHeight` padding above plus the sheet's own
          `keyboardBehavior="interactive"` +
          `android_keyboardInputMode="adjustResize"`.
        */}
        <TextInput
          style={styles.input}
          placeholder="Group name"
          placeholderTextColor={colors.textSupplementary}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus
          maxLength={80}
          accessibilityLabel="Group name"
          testID="rename-group-input"
        />
        <TouchableOpacity
          style={[styles.saveButton, !canSave && styles.disabled]}
          onPress={handleSave}
          disabled={!canSave}
          accessibilityLabel="Save group name"
          testID="rename-group-save"
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
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
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 40,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 16,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 15,
      color: colors.textBody,
      fontWeight: '500',
      marginBottom: 24,
    },
    saveButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
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

export default RenameGroupSheet;
