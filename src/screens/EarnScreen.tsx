import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

const EarnScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Earn</Text>
      <Text style={styles.subtitle}>Coming soon!</Text>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.brandPink,
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      color: colors.white,
      fontSize: 28,
      fontWeight: '700',
      marginBottom: 12,
    },
    subtitle: {
      color: colors.white,
      fontSize: 16,
      opacity: 0.8,
    },
  });

export default EarnScreen;
