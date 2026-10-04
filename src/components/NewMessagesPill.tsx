import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createNewMessagesPillStyles } from '../styles/NewMessagesPill.styles';
export default function NewMessagesPill({
  onPress,
  testID,
}: {
  onPress: () => void;
  testID: string;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => createNewMessagesPillStyles(colors), [colors]);
  const t = useTranslation();
  return (
    <View style={styles.lane} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.button}
        onPress={onPress}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('liveMessages.newMessages')}
      >
        <Text style={styles.text}>{t('liveMessages.newMessages')}</Text>
      </TouchableOpacity>
    </View>
  );
}
