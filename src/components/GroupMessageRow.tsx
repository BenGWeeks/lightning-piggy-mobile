import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import MessageBubble from './MessageBubble';
import { useThemeColors } from '../contexts/ThemeContext';
import { createGroupMessageRowStyles, senderAvatarColors } from '../styles/GroupMessageRow.styles';
import { senderInitials } from '../utils/groupSenderRuns';
import { isSupportedImageUrl } from '../utils/imageUrl';

type Props = React.ComponentProps<typeof MessageBubble> & {
  senderPubkey: string;
  senderPicture: string | null;
  showSender: boolean;
  onOpenSender: (pubkey: string) => void;
};
const GroupMessageRow = React.memo(function GroupMessageRow({
  senderPubkey,
  senderPicture,
  showSender,
  onOpenSender,
  senderName,
  ...bubble
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createGroupMessageRowStyles(colors), [colors]);
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  const open = useCallback(() => onOpenSender(senderPubkey), [onOpenSender, senderPubkey]);
  if (bubble.fromMe)
    return (
      <MessageBubble
        {...bubble}
        senderName={bubble.content.kind === 'unsupported' ? senderName : undefined}
      />
    );
  const picture =
    senderPicture && isSupportedImageUrl(senderPicture) && failedPicture !== senderPicture
      ? senderPicture
      : null;
  const name = senderName ?? senderPubkey;
  const colorIndex =
    Array.from(senderPubkey).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) %
    senderAvatarColors.length;
  return (
    <View style={styles.row}>
      <View style={styles.gutter}>
        {showSender ? (
          <TouchableOpacity
            onPress={open}
            accessibilityRole="button"
            accessibilityLabel={name}
            testID={`group-msg-avatar-${bubble.id}`}
            style={[styles.avatar, { backgroundColor: senderAvatarColors[colorIndex] }]}
          >
            {picture ? (
              <Image
                source={{ uri: picture }}
                style={styles.avatar}
                cachePolicy="memory-disk"
                autoplay={false}
                recyclingKey={senderPubkey}
                onError={() => setFailedPicture(picture)}
              />
            ) : (
              <Text style={styles.initials}>{senderInitials(name)}</Text>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.body}>
        {showSender ? (
          <TouchableOpacity
            onPress={open}
            accessibilityRole="button"
            accessibilityLabel={name}
            testID={`group-msg-sender-${bubble.id}`}
          >
            <Text style={styles.name}>{name}</Text>
          </TouchableOpacity>
        ) : null}
        <MessageBubble
          {...bubble}
          senderName={bubble.content.kind === 'unsupported' ? senderName : undefined}
        />
      </View>
    </View>
  );
});
export default GroupMessageRow;
