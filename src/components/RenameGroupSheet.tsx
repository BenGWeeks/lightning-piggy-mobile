import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Text,
  TouchableOpacity,
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Platform,
} from 'react-native';
import { Alert } from './BrandedAlert';
import {
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { BottomSheetModal } from './AccessibleBottomSheetModal';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createRenameGroupSheetStyles } from '../styles/RenameGroupSheet.styles';
import { useGroups } from '../contexts/GroupsContext';
import { marmotSendError } from '../services/marmotSend';

interface Props {
  visible: boolean;
  groupId: string | null;
  onClose: () => void;
}

const RenameGroupSheet: React.FC<Props> = ({ visible, groupId, onClose }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createRenameGroupSheetStyles(colors), [colors]);
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
      Alert.alert(
        t('renameGroupSheet.nameRequiredTitle'),
        t('renameGroupSheet.nameRequiredMessage'),
      );
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
        Alert.alert(t('renameGroupSheet.errorTitle'), t('renameGroupSheet.renameFailedMessage'));
      }
    } catch (err) {
      // NIP-17: an AsyncStorage write failure. Marmot: a commit that didn't go
      // out (e.g. the chat is still applying a change, #1280) — say why. Without
      // try/finally `saving` would stick true and Save would stay disabled.
      if (__DEV__) console.warn('[RenameGroupSheet] renameGroup failed:', err);
      Alert.alert(
        t('renameGroupSheet.saveFailedTitle'),
        group?.protocol === 'marmot'
          ? marmotSendError(err)
          : t('renameGroupSheet.saveFailedMessage'),
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
        <Text style={styles.title}>{t('renameGroupSheet.title')}</Text>
        <Text style={styles.label}>{t('renameGroupSheet.groupNameLabel')}</Text>
        <BottomSheetTextInput
          style={styles.input}
          placeholder={t('renameGroupSheet.groupNamePlaceholder')}
          placeholderTextColor={colors.textSupplementary}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus
          maxLength={80}
          accessibilityLabel={t('renameGroupSheet.groupNameA11y')}
          testID="rename-group-input"
        />
        <TouchableOpacity
          style={[styles.saveButton, !canSave && styles.disabled]}
          onPress={handleSave}
          disabled={!canSave}
          accessibilityLabel={t('renameGroupSheet.saveA11y')}
          testID="rename-group-save"
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveButtonText}>{t('renameGroupSheet.save')}</Text>
          )}
        </TouchableOpacity>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
};

export default RenameGroupSheet;
