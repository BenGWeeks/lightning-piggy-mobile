import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type TextStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ProfileIcon from './ProfileIcon';
import { useNostr } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import type { AccountDrawerNavigation } from '../navigation/types';

interface Props {
  /**
   * The page-identifying glyph rendered inside the round badge on the
   * left. Passed as a ReactNode so the screen can choose between tinted
   * `Image` (Home) and `Svg`/Lucide components (Messages, Explore,
   * Friends) — both match their tab-bar counterparts. Decorative only:
   * the badge never navigates anywhere on tap (per #139's AC).
   */
  icon: React.ReactNode;
  /** Page title text. For Home this carries the "Hello, <name>!" greeting. */
  title: string;
  /**
   * Right-hand slot. Defaults to a `ProfileIcon` that opens the Account
   * screen, which is what every tab wants today. A screen can override if
   * it needs something different (currently none do).
   */
  rightAction?: React.ReactNode;
  /** Optional accessibility label for the title region (rarely useful — the
   * title text is already announced — but lets screens override for e.g.
   * Home's dynamic greeting). */
  accessibilityLabel?: string;
  /** Optional style override for the title Text. Home uses this to pull the
   * greeting back to the lighter weight/size it had pre-#139 (section
   * titles like "Messages"/"Friends"/"Explore" keep the default bold). */
  titleStyle?: TextStyle;
  /**
   * Optional tap handler for the round badge. Top-level tabs leave this
   * undefined — the badge stays decorative-only per #139. Sub-screens
   * that reuse `TabHeader` (e.g. Lessons) can pass a `goBack` callback
   * here and swap the glyph for a `ChevronLeft`, getting a tappable
   * back affordance without redesigning the header.
   */
  onIconPress?: () => void;
  /** Accessibility label for the badge when `onIconPress` is set. */
  iconAccessibilityLabel?: string;
}

/**
 * Shared header row for the four top-level tabs (Home, Messages, Explore,
 * Friends). Fixes the prior inconsistency where each screen rolled its
 * own page-icon badge, title position, and profile-icon placement.
 *
 * Layout: `[badge]  [title]  <spacer>  [right action]`, padded above by
 * the safe-area top inset + 12 px so the brand pink bleeds behind the
 * status bar cleanly. The badge is brand-white with a pink-tinted glyph
 * so it reads against the pink background art every screen sets as its
 * container.
 */
const TabHeader: React.FC<Props> = ({
  icon,
  title,
  rightAction,
  accessibilityLabel,
  titleStyle,
  onIconPress,
  iconAccessibilityLabel,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { profile } = useNostr();

  // Profile icon opens the account drawer (wraps MainTabs). See issue #100.
  const defaultRight = (
    <ProfileIcon
      uri={profile?.picture}
      size={36}
      onPress={() => {
        const parent = navigation.getParent<AccountDrawerNavigation>();
        parent?.openDrawer();
      }}
    />
  );

  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      {onIconPress ? (
        <TouchableOpacity
          style={styles.badge}
          onPress={onIconPress}
          accessibilityLabel={iconAccessibilityLabel ?? 'Back'}
          accessibilityRole="button"
          testID="tab-header-icon-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {icon}
        </TouchableOpacity>
      ) : (
        <View
          style={styles.badge}
          accessible={false}
          // Decorative only — not tappable. See #139 AC.
          importantForAccessibility="no-hide-descendants"
        >
          {icon}
        </View>
      )}
      <Text
        style={[styles.title, titleStyle]}
        numberOfLines={1}
        accessibilityLabel={accessibilityLabel ?? title}
      >
        {title}
      </Text>
      <View style={styles.spacer} />
      {rightAction ?? defaultRight}
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingBottom: 16,
    },
    badge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.9)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      color: colors.white,
      // Slightly lighter than the previous per-screen 28/700 because Home's
      // "Hello, <name>!" greeting reads better at a softer weight and the
      // section titles (Messages / Friends / Explore) still look substantial.
      fontSize: 24,
      fontWeight: '600',
      flexShrink: 1,
    },
    spacer: {
      flex: 1,
    },
  });

export default TabHeader;
