import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import MentionChip from '../nostr/MentionChip';
import EmbeddedEventCard from '../nostr/EmbeddedEventCard';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { useEmbeddedEvent } from '../../hooks/useEmbeddedEvent';
import { createNostrContentStyles } from '../../styles/NostrContent.styles';
import type { ReplyTarget } from '../../utils/nip10';

interface Props {
  reply: ReplyTarget;
  testID?: string;
}

/**
 * Context above a reply on the Posts tab's "Posts & replies" view (#1332):
 * "Replying to @Name" (a tappable chip), then a compact preview of the parent
 * note, which opens it. The parent comes through the batched, cached embed
 * fetch; its author is authoritative once loaded, the reply's tags are the
 * fallback. If the parent can't be found, only the "Replying to" line shows.
 */
const ReplyContext: React.FC<Props> = ({ reply, testID }) => {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createNostrContentStyles(colors), [colors]);
  const { result } = useEmbeddedEvent(reply.ref);
  const author = result?.event?.pubkey ?? reply.authorPubkey;
  return (
    <View style={styles.replyBlock} testID={testID}>
      <Text style={styles.replyContext}>
        {author ? (
          <>
            {t('profileTabs.replyingTo')}{' '}
            <MentionChip pubkey={author} styles={styles} testID={`${testID}-author`} />
          </>
        ) : (
          t('profileTabs.replyingToPost')
        )}
      </Text>
      <EmbeddedEventCard token={reply.ref} styles={styles} compact />
    </View>
  );
};

export default React.memo(ReplyContext);
