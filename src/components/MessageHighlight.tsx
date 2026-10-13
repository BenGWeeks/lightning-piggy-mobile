import React, { useContext, useMemo } from 'react';
import { View } from 'react-native';
import { ChatMessageHighlightContext } from '../contexts/ChatMessageHighlightContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMessageHighlightStyles } from '../styles/MessageHighlight.styles';
/** A stable row wrapper: highlighting never remounts media players or cards. */
export function MessageHighlight({
  messageId,
  children,
}: {
  messageId: string;
  children: React.ReactNode;
}) {
  const highlighted = useContext(ChatMessageHighlightContext) === messageId;
  const colors = useThemeColors();
  const styles = useMemo(() => createMessageHighlightStyles(colors), [colors]);
  return (
    <View
      style={highlighted ? styles.highlighted : undefined}
      testID={highlighted ? `message-highlight-${messageId}` : undefined}
    >
      {children}
    </View>
  );
}
