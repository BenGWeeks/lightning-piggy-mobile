import React, { useMemo } from 'react';
import { Check } from 'lucide-react-native';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createAdvancedScreenStyles } from '../styles/AdvancedScreen.styles';
import type { OutgoingBubbleStyle } from '../styles/outgoingBubblePalettes';
const OPTIONS: OutgoingBubbleStyle[] = ['A', 'B', 'C'];
export default function OutgoingBubbleStyleSection() {
  const { colors, outgoingBubbleStyle, setOutgoingBubbleStyle } = useTheme();
  const t = useTranslation();
  const styles = useMemo(() => createAdvancedScreenStyles(colors), [colors]);
  if (!__DEV__) return null;
  return (
    <View testID="advanced-bubble-style">
      {OPTIONS.map((option) => (
        <TouchableOpacity
          key={option}
          style={styles.navRow}
          onPress={() => setOutgoingBubbleStyle(option)}
          accessibilityLabel={t(`advancedScreen.bubbleStyle${option}`)}
          accessibilityRole="radio"
          accessibilityState={{ selected: outgoingBubbleStyle === option }}
          testID={`advanced-bubble-style-${option}`}
        >
          <Text style={styles.experimentalLabel}>{t(`advancedScreen.bubbleStyle${option}`)}</Text>
          {outgoingBubbleStyle === option ? <Check size={18} color={colors.white} /> : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}
