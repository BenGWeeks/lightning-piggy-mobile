import { useMentionProfile } from '../hooks/useMentionProfile';
import { shortNpubLabel } from '../utils/nip27';
import { MessageHighlight } from './MessageHighlight';
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
  // The screen's member snapshot precedes the general display cache, but
  // its npub placeholder must still be allowed to resolve.
  const memberProfile =
    senderName && !senderName.startsWith('npub1')
      ? { name: senderName, picture: senderPicture }
      : null;
  const profile = useMentionProfile(senderPubkey, memberProfile);
  const name = profile.name || senderName || shortNpubLabel(senderPubkey);
  const avatar = profile.picture || senderPicture;
  const colors = useThemeColors();
  const styles = useMemo(() => createGroupMessageRowStyles(colors), [colors]);
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  const open = useCallback(() => onOpenSender(senderPubkey), [onOpenSender, senderPubkey]);
  if (bubble.fromMe)
    return (
      <MessageBubble
        {...bubble}
        senderName={bubble.content.kind === 'unsupported' ? name : undefined}
      />
    );
  const picture = avatar && isSupportedImageUrl(avatar) && failedPicture !== avatar ? avatar : null;
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
          senderName={bubble.content.kind === 'unsupported' ? name : undefined}
        />
      </View>
    </View>
  );
});
export default React.memo(function HighlightedGroupMessageRow(props: Props) {
  return (
    <MessageHighlight messageId={props.id}>
      <GroupMessageRow {...props} />
    </MessageHighlight>
  );
});
