import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import type { MessageBubbleStyles } from '../styles/MessageBubble.styles';
import type { MessageQuote as MessageQuoteData } from '../utils/messageQuote';

/**
 * The quoted parent a Marmot reply carries, shown above the reply's content:
 * who wrote it and a short preview. A parent outside the loaded thread (older
 * than the loaded slice, or deleted) shows a muted "Earlier message" rather
 * than nothing, so the reply still reads as a reply.
 */
export const MessageQuote: React.FC<{
  styles: MessageBubbleStyles;
  quote: MessageQuoteData;
  fromMe: boolean;
  messageId: string;
  testIdPrefix: string;
}> = ({ styles, quote, fromMe, messageId, testIdPrefix }) => {
  const t = useTranslation();
  const missing = quote.text === null;
  const author = quote.fromMe
    ? t('messageBubble.quoteYou')
    : (quote.authorName ?? t('messageBubble.quoteSomeone'));
  const body = missing ? t('messageBubble.quoteUnavailable') : quote.text;
  return (
    <View
      style={[styles.quoteBlock, fromMe && styles.quoteBlockMe]}
      testID={`${testIdPrefix}-quote-${messageId}`}
      accessibilityLabel={
        missing
          ? t('messageBubble.quoteMissingA11y')
          : t('messageBubble.quoteA11y', { author, text: body })
      }
    >
      {missing ? null : (
        <Text style={[styles.quoteAuthor, fromMe && styles.quoteAuthorMe]}>{author}</Text>
      )}
      <Text
        style={[styles.quoteText, fromMe && styles.quoteTextMe, missing && styles.quoteTextMissing]}
        numberOfLines={2}
      >
        {body}
      </Text>
    </View>
  );
};
