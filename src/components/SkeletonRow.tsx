import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useThemeColors } from '../contexts/ThemeContext';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

interface SkeletonRowProps {
  /** Total row height in dp. Must equal the real row's height to avoid
   * layout shift when the skeleton is replaced by real content. */
  height: number;
  /** Avatar diameter in dp. `0` skips the avatar block (leading-only rows). */
  avatarSize?: number;
  /** Number of text "lines" to draw on the right (1 = name only, 2 = name +
   * subtitle). Trailing edge gets a small shape regardless (for timestamp /
   * action button silhouette) when `lines === 2`. */
  lines?: 1 | 2;
}

/**
 * One row of placeholder content with a moving-gradient shimmer.
 *
 * The shimmer effect is a `LinearGradient` ribbon that sweeps left-to-right
 * across the row at a 1.5 s loop. The gradient itself is animated via
 * `react-native-reanimated`'s `withRepeat(withTiming, -1)` so it runs on
 * the UI thread (no JS-bridge cost per frame).
 *
 * Why a custom component instead of a library: react-native-keyboard-controller
 * + reanimated 4 + expo-linear-gradient are already in deps for other
 * features. A skeleton/shimmer lib would add weight for one job.
 *
 * Sizing rule: pass `height` equal to the real row's height (e.g.
 * `CONTACT_LIST_ITEM_HEIGHT` from `ContactListItem.tsx`). Mismatched heights
 * produce layout shift the moment the skeleton is replaced — visible jank.
 */
const SkeletonRow: React.FC<SkeletonRowProps> = ({ height, avatarSize = 0, lines = 2 }) => {
  const colors = useThemeColors();
  const styles = makeStyles(colors, height, avatarSize);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.linear }),
      -1,
      false,
    );
  }, [progress]);

  // The shimmer ribbon starts off-screen left (-100%) and ends off-screen
  // right (+100%), so a full sweep cycles cleanly back to the start with
  // no visible "snap" between iterations.
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * 400 - 200 }],
  }));

  const Block: React.FC<{ style: object }> = ({ style }) => (
    <View style={[styles.block, style]}>
      <AnimatedLinearGradient
        colors={['transparent', colors.surface, 'transparent']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.shimmer, shimmerStyle]}
      />
    </View>
  );

  return (
    <View style={styles.row}>
      {avatarSize > 0 ? <Block style={styles.avatar} /> : null}
      <View style={styles.lines}>
        <Block style={styles.lineLong} />
        {lines === 2 ? <Block style={styles.lineShort} /> : null}
      </View>
      {lines === 2 ? <Block style={styles.trailing} /> : null}
    </View>
  );
};

const makeStyles = (
  colors: ReturnType<typeof useThemeColors>,
  height: number,
  avatarSize: number,
) =>
  StyleSheet.create({
    row: {
      height,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      gap: 12,
    },
    avatar: {
      width: avatarSize,
      height: avatarSize,
      borderRadius: avatarSize / 2,
    },
    lines: {
      flex: 1,
      gap: 8,
    },
    lineLong: {
      height: 14,
      width: '60%',
      borderRadius: 4,
    },
    lineShort: {
      height: 11,
      width: '40%',
      borderRadius: 4,
    },
    trailing: {
      width: 32,
      height: 11,
      borderRadius: 4,
    },
    block: {
      // Faint base tint that's visible on both light + dark surfaces.
      // The shimmer ribbon (drawn on top via absoluteFill) does the work
      // of conveying "loading"; the base just hints at the row's shape.
      backgroundColor: colors.divider,
      overflow: 'hidden',
    },
    shimmer: {
      ...StyleSheet.absoluteFillObject,
      width: '100%',
    },
  });

interface SkeletonListProps {
  /** Number of skeleton rows to draw. */
  count: number;
  /** Per-row height — see `SkeletonRow.height`. */
  rowHeight: number;
  /** Per-row avatar diameter — see `SkeletonRow.avatarSize`. */
  avatarSize?: number;
  /** Per-row text-line count — see `SkeletonRow.lines`. */
  lines?: 1 | 2;
}

/**
 * Convenience wrapper: render N stacked SkeletonRows. Used as the
 * placeholder for a list while the real data hydrates.
 */
export const SkeletonList: React.FC<SkeletonListProps> = ({
  count,
  rowHeight,
  avatarSize = 0,
  lines = 2,
}) => (
  <View accessibilityLabel="Loading" accessibilityRole="progressbar">
    {Array.from({ length: count }, (_, i) => (
      <SkeletonRow key={i} height={rowHeight} avatarSize={avatarSize} lines={lines} />
    ))}
  </View>
);

export default SkeletonRow;
