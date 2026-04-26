import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image, Alert } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { useGroups } from '../contexts/GroupsContext';
import CreateGroupSheet from '../components/CreateGroupSheet';
import type { RootStackParamList } from '../navigation/types';
import type { Group } from '../types/groups';

type GroupsNavigation = NativeStackNavigationProp<RootStackParamList, 'Groups'>;

const GroupsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<GroupsNavigation>();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { groups, deleteGroup } = useGroups();
  const [createVisible, setCreateVisible] = useState(false);

  const openGroup = useCallback(
    (group: Group) => {
      navigation.navigate('GroupConversation', { groupId: group.id });
    },
    [navigation],
  );

  const handleLongPress = useCallback(
    (group: Group) => {
      Alert.alert(group.name, undefined, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteGroup(group.id),
        },
      ]);
    },
    [deleteGroup],
  );

  const renderItem = useCallback(
    ({ item }: { item: Group }) => (
      <TouchableOpacity
        style={styles.row}
        onPress={() => openGroup(item)}
        onLongPress={() => handleLongPress(item)}
        activeOpacity={0.6}
        accessibilityLabel={`Open group ${item.name}`}
        testID={`group-row-${item.id}`}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>{(item.name[0] || '?').toUpperCase()}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {item.memberPubkeys.length} member{item.memberPubkeys.length === 1 ? '' : 's'}
          </Text>
        </View>
      </TouchableOpacity>
    ),
    [openGroup, handleLongPress, styles],
  );

  return (
    <View style={styles.container}>
      <Image
        source={require('../../assets/images/friends-bg.png')}
        style={styles.bgImage}
        resizeMode="contain"
      />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.titleRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
            testID="groups-back"
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path
                d="m15 18-6-6 6-6"
                stroke={colors.brandPink}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </TouchableOpacity>
          <Text style={styles.title}>Groups</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setCreateVisible(true)}
            accessibilityLabel="Create group"
            testID="create-group-button"
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 5v14M5 12h14"
                stroke={colors.white}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            </Svg>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.content}>
        {groups.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Text style={styles.emptySubtitle}>
              Create a group to chat with multiple friends at once.
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => setCreateVisible(true)}
              accessibilityLabel="Create your first group"
              testID="create-first-group"
            >
              <Text style={styles.emptyButtonText}>Create Group</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={groups}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>

      <CreateGroupSheet
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={(group) => navigation.navigate('GroupConversation', { groupId: group.id })}
      />
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.brandPink,
    },
    bgImage: {
      position: 'absolute',
      width: '120%',
      height: 420,
      right: -40,
      top: -20,
      opacity: 0.15,
    },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.9)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    addButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.2)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      color: colors.white,
      fontSize: 28,
      fontWeight: '700',
    },
    content: {
      flex: 1,
      backgroundColor: colors.white,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      marginTop: -24,
    },
    listContent: {
      paddingTop: 12,
      paddingBottom: 20,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 12,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.brandPinkLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarLetter: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.brandPink,
    },
    info: {
      flex: 1,
    },
    name: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textHeader,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    emptyState: {
      padding: 40,
      alignItems: 'center',
      gap: 8,
      marginTop: 40,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textHeader,
    },
    emptySubtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
    },
    emptyButton: {
      backgroundColor: colors.brandPink,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
      marginTop: 8,
    },
    emptyButtonText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
  });

export default GroupsScreen;
