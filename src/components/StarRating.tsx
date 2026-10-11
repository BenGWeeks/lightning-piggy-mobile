import React, { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Star } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createStarRatingStyles } from '../styles/StarRating.styles';
import { STARS_MAX } from '../utils/productReviews';

// Layout-only styles (no palette dependency) — built once at module scope.
const styles = createStarRatingStyles();

interface StarRatingProps {
  /** Rating in stars (0..STARS_MAX); may be fractional. */
  value: number;
  size?: number;
  testID?: string;
}

/**
 * Read-only star rating. Whole stars are drawn filled or empty directly; only
 * a fractional star clips a filled glyph inside its own fixed-size box.
 *
 * It used to clip ONE percentage-width overlay of five filled stars. On
 * Android that overlay wasn't clipped inside the review rows, so every row
 * showed five filled stars whatever the rating (#1276). Drawing per star
 * means a whole-star rating involves no clipping at all.
 */
export const StarRating: React.FC<StarRatingProps> = ({ value, size = 16, testID }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const clamped = Math.max(0, Math.min(STARS_MAX, value));

  return (
    <View
      style={styles.starRow}
      testID={testID}
      accessibilityLabel={t('starRating.readOnly', {
        value: clamped.toFixed(1),
        max: STARS_MAX,
      })}
    >
      {Array.from({ length: STARS_MAX }, (_, i) => {
        // How much of star i is filled: 1 = whole, 0 = empty, else partial.
        const fill = Math.max(0, Math.min(1, clamped - i));
        const whole = fill >= 1;
        return (
          <View
            key={i}
            style={{ width: size, height: size }}
            testID={
              testID
                ? `${testID}-star-${i + 1}-${whole ? 'full' : fill > 0 ? 'partial' : 'empty'}`
                : undefined
            }
          >
            <Star
              size={size}
              color={whole ? colors.amber : colors.divider}
              fill={whole ? colors.amber : 'none'}
              strokeWidth={2}
            />
            {fill > 0 && !whole ? (
              <View style={[styles.partial, { width: size * fill }]} pointerEvents="none">
                <Star size={size} color={colors.amber} fill={colors.amber} strokeWidth={2} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
};

interface StarRatingInputProps {
  /** Current selection (1..STARS_MAX; 0 = none). */
  value: number;
  onChange: (stars: number) => void;
  size?: number;
  testID?: string;
}

/** Interactive 1..STARS_MAX star picker. */
export const StarRatingInput: React.FC<StarRatingInputProps> = ({
  value,
  onChange,
  size = 28,
  testID,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;

  return (
    <View
      style={styles.inputRow}
      testID={testID}
      accessibilityRole="adjustable"
      // Expose the rating to screen readers and let them change it: without
      // these, "adjustable" is announced but increment/decrement gestures do
      // nothing (mirrors AmountSlider; Copilot review on #948).
      accessibilityLabel={t('starRating.input')}
      accessibilityValue={{ min: 0, max: STARS_MAX, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        // Clamp to 0..STARS_MAX so decrement can reach 0 ("none"), matching the
        // documented value range and `accessibilityValue.min` above (Copilot
        // review on #948).
        if (e.nativeEvent.actionName === 'increment') {
          onChange(Math.min(STARS_MAX, value + 1));
        } else if (e.nativeEvent.actionName === 'decrement') {
          onChange(Math.max(0, value - 1));
        }
      }}
    >
      {Array.from({ length: STARS_MAX }).map((_, i) => {
        const star = i + 1;
        const filled = star <= shown;
        return (
          <Pressable
            key={star}
            onPress={() => onChange(star)}
            onPressIn={() => setHover(star)}
            onPressOut={() => setHover(null)}
            accessibilityLabel={t('starRating.rate', { count: star })}
            testID={testID ? `${testID}-star-${star}` : undefined}
            hitSlop={4}
            style={styles.inputStar}
          >
            <Star
              size={size}
              color={filled ? colors.amber : colors.divider}
              fill={filled ? colors.amber : 'transparent'}
              strokeWidth={2}
            />
          </Pressable>
        );
      })}
    </View>
  );
};

export default StarRating;
