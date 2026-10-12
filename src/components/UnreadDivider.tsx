import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createUnreadDividerStyles } from '../styles/UnreadDivider.styles';

/** "Unread messages" rule drawn above the first unread message (#1295). */
const UnreadDivider: React.FC<{ testID: string }> = ({ testID }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createUnreadDividerStyles(colors), [colors]);
  const t = useTranslation();
  const label = t('liveMessages.unreadDivider');
  return (
    <View style={styles.row} testID={testID} accessibilityRole="header" accessibilityLabel={label}>
      <View style={styles.line} />
      <View style={styles.pill}>
        <Text style={styles.text}>{label}</Text>
      </View>
      <View style={styles.line} />
    </View>
  );
};

export default React.memo(UnreadDivider);
