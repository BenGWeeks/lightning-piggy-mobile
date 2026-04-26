import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { UserRound } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import type { ConversationSummary } from '../utils/conversationSummaries';
import { conversationPreview, formatConversationTimestamp } from '../utils/conversationSummaries';

interface Props {
  summary: ConversationSummary;
  onPress?: () => void;
}

const ConversationRow: React.FC<Props> = ({ summary, onPress }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [avatarError, setAvatarError] = useState(false);
  useEffect(() => {
    setAvatarError(false);
  }, [summary.picture]);

  const showImage = !!summary.picture && !avatarError;
  const timestamp = formatConversationTimestamp(summary.lastActivityAt);
  const preview = conversationPreview(summary);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={onPress ? 0.6 : 1}
      accessibilityLabel={`Conversation with ${summary.name}`}
      testID={`conversation-row-${summary.id}`}
    >
      <View style={styles.avatar}>
        {showImage ? (
          <Image
            source={{ uri: summary.picture! }}
            style={styles.avatarImage}
            cachePolicy="disk"
            transition={200}
            recyclingKey={summary.picture ?? undefined}
            onError={() => setAvatarError(true)}
          />
        ) : (
          <UserRound size={22} color={colors.textBody} strokeWidth={1.75} />
        )}
      </View>
      <View style={styles.info}>
        <View style={styles.topRow}>
          <Text style={styles.name} numberOfLines={1}>
            {summary.name}
          </Text>
          <Text style={styles.timestamp} numberOfLines={1}>
            {timestamp}
          </Text>
        </View>
        <Text style={styles.preview} numberOfLines={1}>
          {preview}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 12,
      gap: 12,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    avatarImage: {
      width: 48,
      height: 48,
      borderRadius: 24,
    },
    info: {
      flex: 1,
      minWidth: 0,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    name: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: colors.textHeader,
    },
    timestamp: {
      fontSize: 12,
      color: colors.textSupplementary,
    },
    preview: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
  });

export default React.memo(ConversationRow);
