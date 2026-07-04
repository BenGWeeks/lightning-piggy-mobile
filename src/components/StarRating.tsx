import React, { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Star } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
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
 * Read-only star rating. Renders a full row of empty stars with a clipped
 * overlay of filled stars whose width is the fractional fill — mirroring the
 * website's partial-star treatment without per-star fraction maths.
 */
export const StarRating: React.FC<StarRatingProps> = ({ value, size = 16, testID }) => {
  const colors = useThemeColors();
  const clamped = Math.max(0, Math.min(STARS_MAX, value));
  const fillPct = (clamped / STARS_MAX) * 100;
  const stars = Array.from({ length: STARS_MAX });

  return (
    <View
      style={styles.starRow}
      testID={testID}
      accessibilityLabel={`${clamped.toFixed(1)} out of ${STARS_MAX} stars`}
    >
      {stars.map((_, i) => (
        <Star key={`bg-${i}`} size={size} color={colors.divider} strokeWidth={2} />
      ))}
      <View style={[styles.overlay, { width: `${fillPct}%` }]} pointerEvents="none">
        {stars.map((_, i) => (
          <Star
            key={`fg-${i}`}
            size={size}
            color={colors.amber}
            fill={colors.amber}
            strokeWidth={2}
          />
        ))}
      </View>
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
      accessibilityLabel="Rating"
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
            accessibilityLabel={`Rate ${star} star${star === 1 ? '' : 's'}`}
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
