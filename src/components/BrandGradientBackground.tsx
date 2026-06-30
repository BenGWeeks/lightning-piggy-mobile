import React from 'react';
import { StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../contexts/ThemeContext';

interface Props {
  style?: StyleProp<ViewStyle>;
}

/**
 * Shared brand gradient fill — hot-pink fading into the secondary brand
 * violet (`brandPurple`) left-to-right. Replaces the flat `brandPink` fills
 * on the pink-heavy Settings + Messages chrome so those surfaces read less
 * monochromatically pink while keeping hot-pink as the dominant identity.
 *
 * The fade is one continuous horizontal sweep (left pink -> right purple)
 * passing through a vivid magenta-violet bridge (`brandGradientMid`) so the
 * hue arc stays saturated and there is no muddy midpoint. Earlier versions
 * held solid pink to ~40% then ramped, which left a visible seam where the
 * gradient "started"; routing through an off-line mid stop weighted toward
 * the pink side (mid at 0.55) keeps hot-pink dominant while reading as a
 * single smooth gradient rather than two flat zones. The endpoints are
 * theme-invariant, so this renders identically (and cleanly) in light and
 * dark mode; it works equally for full-screen Settings panels and the short
 * pink header bands on Messages / group conversations, where a
 * `colors.surface`/`colors.background` sheet overlays the lower portion.
 *
 * Rendered as an absolute fill behind existing content by default; callers
 * can override via `style`.
 */
const BrandGradientBackground: React.FC<Props> = ({ style }) => {
  const colors = useThemeColors();
  return (
    <LinearGradient
      colors={[colors.brandPink, colors.brandGradientMid, colors.brandPurple]}
      locations={[0, 0.55, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[StyleSheet.absoluteFill, style]}
      pointerEvents="none"
    />
  );
};

export default BrandGradientBackground;
