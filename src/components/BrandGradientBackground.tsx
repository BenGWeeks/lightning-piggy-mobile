import React from 'react';
import { StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../contexts/ThemeContext';

interface Props {
  style?: StyleProp<ViewStyle>;
}

/**
 * Shared brand gradient fill — hot-pink easing into the secondary brand
 * violet (`brandPurple`) left-to-right. Replaces the flat `brandPink` fills
 * on the pink-heavy Settings + Messages chrome so those surfaces read less
 * monochromatically pink while keeping hot-pink as the dominant identity.
 *
 * The transition is horizontal (left pink -> right purple) and pink-weighted
 * (solid through ~40%) so it works equally for full-screen Settings panels
 * and the short pink header bands on Messages / group conversations, where a
 * `colors.surface`/`colors.background` sheet overlays the lower portion.
 *
 * Rendered as an absolute fill behind existing content by default; callers
 * can override via `style`.
 */
const BrandGradientBackground: React.FC<Props> = ({ style }) => {
  const colors = useThemeColors();
  return (
    <LinearGradient
      colors={[colors.brandPink, colors.brandPink, colors.brandPurple]}
      locations={[0, 0.4, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents="none"
    />
  );
};

export default BrandGradientBackground;
