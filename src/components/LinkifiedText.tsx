import React from 'react';
import { Linking, Text } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import type { MessageBubbleStyles } from '../styles/MessageBubble.styles';
import { hasLink, linkifySegments } from '../utils/linkify';

/** A bubble's plain text with its URLs rendered as tappable link spans. */
export const LinkifiedText: React.FC<{
  text: string;
  fromMe: boolean;
  styles: MessageBubbleStyles;
  messageId: string;
  testIdPrefix: string;
}> = ({ text, fromMe, styles, messageId, testIdPrefix }) => {
  const t = useTranslation();
  return (
    <Text style={[styles.bubbleText, fromMe && styles.bubbleTextMe]}>
      {hasLink(text)
        ? linkifySegments(text).map((seg, i) =>
            seg.url ? (
              <Text
                key={i}
                style={[styles.bubbleLink, fromMe && styles.bubbleLinkMe]}
                onPress={() => {
                  // openURL rejects on a malformed URL / missing handler —
                  // swallow so a bad link can't raise an unhandled rejection.
                  void Linking.openURL(seg.url as string).catch(() => {});
                }}
                accessibilityRole="link"
                accessibilityLabel={t('messageBubble.openLink', { url: seg.url })}
                testID={`${testIdPrefix}-link-${messageId}-${i}`}
              >
                {seg.text}
              </Text>
            ) : (
              seg.text
            ),
          )
        : text}
    </Text>
  );
};
