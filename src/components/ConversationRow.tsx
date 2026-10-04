import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { UserRound } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { createConversationRowStyles } from '../styles/ConversationRow.styles';
import DmProtocolTag from './DmProtocolTag';
import type { ConversationSummary } from '../utils/conversationSummaries';
import { conversationPreview, formatConversationTimestamp } from '../utils/conversationSummaries';
import { isSupportedImageUrl } from '../utils/imageUrl';

interface Props {
  summary: ConversationSummary;
  // Receives `summary` so the parent can pass a single stable handler
  // reference across all rows (no fresh arrow per render). Without this,
  // React.memo's prop comparison saw a new onPress every render and
  // re-rendered the row even when its data hadn't changed (#300 follow-up).
  onPress?: (summary: ConversationSummary) => void;
}

const ConversationRow: React.FC<Props> = ({ summary, onPress }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createConversationRowStyles(colors), [colors]);
  const [avatarError, setAvatarError] = useState(false);
  useEffect(() => {
    setAvatarError(false);
  }, [summary.picture]);

  // Pre-filter unsupported URLs (`.svg`, `.heic`, etc.) — see #189.
  const showImage = !!summary.picture && !avatarError && isSupportedImageUrl(summary.picture);
  const timestamp = formatConversationTimestamp(summary.lastActivityAt);
  const preview = conversationPreview(summary);
  // Bind the row's summary into the parent handler at the leaf so the
  // <TouchableOpacity> sees a stable callback per render, while the
  // parent still hands us a single handler.
  const handlePress = useMemo(
    () => (onPress ? () => onPress(summary) : undefined),
    [onPress, summary],
  );

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      activeOpacity={onPress ? 0.6 : 1}
      accessibilityLabel={`Conversation with ${summary.name}`}
      testID={`conversation-row-${summary.id}`}
    >
      <View style={styles.avatar}>
        {showImage ? (
          <Image
            source={{ uri: summary.picture! }}
            style={styles.avatarImage}
            cachePolicy="memory-disk"
            transition={200}
            recyclingKey={summary.picture ?? undefined}
            onError={() => setAvatarError(true)}
            // First frame only — animated avatars in the inbox list
            // would otherwise spawn a per-row FrameDecoderExe thread.
            // See #243.
            autoplay={false}
            // Explicit decode-time size hint (#731 Fix 4): without this
            // Glide logs "-2147483648x-2147483648" (no hint) and allocates
            // a full-resolution bitmap before downscaling, costing ~600 ms
            // per avatar on Messages focus. Matching width/height to the
            // rendered style dimensions (48 dp) tells Glide to downsample
            // at the BitmapFactory stage — dramatically cheaper allocation
            // and faster decode. `contentFit="cover"` maps to
            // Glide's `centerCrop()` transform and must pair with the
            // explicit size for the downsample hint to take effect.
            contentFit="cover"
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
          {summary.protocol && (
            <DmProtocolTag
              protocol={summary.protocol}
              testID={`conversation-protocol-tag-${summary.id}`}
            />
          )}
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

export default React.memo(ConversationRow);
