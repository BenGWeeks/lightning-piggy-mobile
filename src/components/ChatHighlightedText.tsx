import React, { useContext, useMemo } from 'react';
import { Text } from 'react-native';
import { ChatSearchContext } from '../contexts/ChatSearchContext';
import { searchRanges } from '../utils/chatSearch';
import { useThemeColors } from '../contexts/ThemeContext';
import { createChatToolsStyles } from '../styles/ChatTools.styles';
export default function ChatHighlightedText({ text }: { text: string }) {
  const query = useContext(ChatSearchContext);
  const colors = useThemeColors();
  const styles = useMemo(() => createChatToolsStyles(colors), [colors]);
  const ranges = useMemo(() => searchRanges(text, query), [text, query]);
  if (!ranges.length) return <>{text}</>;
  let end = 0;
  const spans = ranges.map((range) => {
    const before = text.slice(end, range.start);
    end = range.end;
    return (
      <React.Fragment key={range.start}>
        {before}
        <Text style={styles.match}>{text.slice(range.start, range.end)}</Text>
      </React.Fragment>
    );
  });
  return (
    <>
      {spans}
      {text.slice(end)}
    </>
  );
}
