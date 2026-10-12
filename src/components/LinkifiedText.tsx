import React, { useMemo } from 'react';
import { Linking, Text } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import type { MessageBubbleStyles } from '../styles/MessageBubble.styles';
import { hasLink, linkifySegments } from '../utils/linkify';
import { splitMentions } from '../utils/chatMentions';
import ChatMentionChip from './ChatMentionChip';

/**
 * A bubble's plain text with its URLs rendered as tappable link spans and its
 * NIP-27 `nostr:npub…` / `nprofile…` mentions as `@Name` chips (#1295).
 */
export const LinkifiedText: React.FC<{
  text: string;
  fromMe: boolean;
  styles: MessageBubbleStyles;
  messageId: string;
  testIdPrefix: string;
}> = ({ text, fromMe, styles, messageId, testIdPrefix }) => {
  const t = useTranslation();
  const segments = useMemo(() => splitMentions(text), [text]);

  const renderLinks = (chunk: string, keyBase: string) =>
    hasLink(chunk)
      ? linkifySegments(chunk).map((seg, i) =>
          seg.url ? (
            <Text
              key={`${keyBase}-${i}`}
              style={[styles.bubbleLink, fromMe && styles.bubbleLinkMe]}
              onPress={() => {
                // openURL rejects on a malformed URL / missing handler —
                // swallow so a bad link can't raise an unhandled rejection.
                void Linking.openURL(seg.url as string).catch(() => {});
              }}
              accessibilityRole="link"
              accessibilityLabel={t('messageBubble.openLink', { url: seg.url })}
              testID={`${testIdPrefix}-link-${messageId}-${keyBase === '0' ? i : `${keyBase}-${i}`}`}
            >
              {seg.text}
            </Text>
          ) : (
            seg.text
          ),
        )
      : chunk;

  return (
    <Text style={[styles.bubbleText, fromMe && styles.bubbleTextMe]}>
      {segments.length === 1 && segments[0].kind === 'text'
        ? renderLinks(text, '0')
        : segments.map((seg, i) =>
            seg.kind === 'mention' ? (
              <ChatMentionChip key={`m-${i}`} pubkey={seg.pubkey} fromMe={fromMe} />
            ) : (
              <React.Fragment key={`t-${i}`}>{renderLinks(seg.text, String(i))}</React.Fragment>
            ),
          )}
    </Text>
  );
};
