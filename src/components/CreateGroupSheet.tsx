import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path, Circle } from 'react-native-svg';
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
import { useGroups } from '../contexts/GroupsContext';
import type { Group } from '../types/groups';

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreated?: (group: Group) => void;
}

const CreateGroupSheet: React.FC<Props> = ({ visible, onClose, onCreated }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { contacts } = useNostr();
  const { createGroup } = useGroups();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['85%'], []);

  useEffect(() => {
    if (visible) {
      setName('');
      setSelected(new Set());
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

  const toggle = (pubkey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      return next;
    });
  };

  const sortedContacts = useMemo(() => {
    return [...contacts].sort((a, b) => {
      const an = (a.profile?.displayName || a.profile?.name || a.petname || a.pubkey).toLowerCase();
      const bn = (b.profile?.displayName || b.profile?.name || b.petname || b.pubkey).toLowerCase();
      return an.localeCompare(bn);
    });
  }, [contacts]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Please enter a group name.');
      return;
    }
    if (selected.size === 0) {
      Alert.alert('Members required', 'Please select at least one member.');
      return;
    }
    setSaving(true);
    const group = await createGroup(trimmed, Array.from(selected));
    setSaving(false);
    onCreated?.(group);
    onClose();
  };

  const canCreate = name.trim().length > 0 && selected.size > 0 && !saving;

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
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>New Group</Text>
        <Text style={styles.label}>Group Name</Text>
        <BottomSheetTextInput
          style={styles.input}
          placeholder="e.g. Family"
          placeholderTextColor={colors.textSupplementary}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={80}
          accessibilityLabel="Group name"
          testID="create-group-name"
        />

        <Text style={styles.label}>Members {selected.size > 0 ? `(${selected.size})` : ''}</Text>
        {sortedContacts.length === 0 ? (
          <Text style={styles.emptyText}>Add Nostr friends first to include them in a group.</Text>
        ) : (
          <View>
            {sortedContacts.map((c) => {
              const displayName =
                c.profile?.displayName || c.profile?.name || c.petname || c.pubkey.slice(0, 12);
              const isSelected = selected.has(c.pubkey);
              return (
                <TouchableOpacity
                  key={c.pubkey}
                  style={styles.row}
                  onPress={() => toggle(c.pubkey)}
                  accessibilityLabel={`${isSelected ? 'Deselect' : 'Select'} ${displayName}`}
                  testID={`member-row-${c.pubkey.slice(0, 12)}`}
                >
                  <View style={styles.avatar}>
                    {c.profile?.picture ? (
                      <Image
                        source={{ uri: c.profile.picture }}
                        style={styles.avatarImage}
                        cachePolicy="disk"
                      />
                    ) : (
                      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                        <Circle cx="12" cy="8" r="4" fill={colors.textSupplementary} />
                        <Path
                          d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6"
                          stroke={colors.textSupplementary}
                          strokeWidth={2}
                          strokeLinecap="round"
                        />
                      </Svg>
                    )}
                  </View>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                    {isSelected && (
                      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                        <Path
                          d="M20 6 9 17l-5-5"
                          stroke={colors.white}
                          strokeWidth={3}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </Svg>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <TouchableOpacity
          style={[styles.createButton, !canCreate && styles.disabled]}
          onPress={handleCreate}
          disabled={!canCreate}
          accessibilityLabel="Create group"
          testID="create-group-submit"
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.createButtonText}>Create Group</Text>
          )}
        </TouchableOpacity>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
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
    contentContainer: {
      paddingBottom: 60,
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
    emptyText: {
      fontSize: 14,
      color: colors.textSupplementary,
      fontStyle: 'italic',
      paddingVertical: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      gap: 12,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    avatarImage: {
      width: 40,
      height: 40,
      borderRadius: 20,
    },
    rowName: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.textHeader,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.divider,
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxActive: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    createButton: {
      backgroundColor: colors.brandPink,
      height: 52,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 24,
    },
    createButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    disabled: {
      opacity: 0.5,
    },
  });

export default CreateGroupSheet;
