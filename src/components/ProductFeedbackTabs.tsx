import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Star, MessageSquare } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { CommentRoot } from '../utils/productComments';
import type { Palette } from '../styles/palettes';
import ProductReviews from './ProductReviews';
import ProductComments from './ProductComments';

interface Props {
  /** Review coordinate `a:30402:<merchant>:<dTag>`. */
  coord: string;
  /** The kind-30402 product event the comment thread roots on. */
  commentRoot: CommentRoot;
  /** Opens the login sheet for signed-out compose attempts. */
  onRequestSignIn: () => void;
}

type Tab = 'reviews' | 'comments';

/**
 * Underlined Reviews / Comments tabs (mirroring the companion website's
 * product feedback tabs) with live counts + icons. Both sections stay mounted
 * (the inactive one hidden) so switching tabs never refetches or loses an
 * in-progress compose, and the counts stay live in the tab labels.
 */
const ProductFeedbackTabs: React.FC<Props> = ({ coord, commentRoot, onRequestSignIn }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState<Tab>('reviews');
  const [reviewCount, setReviewCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);

  const onReviewCount = useCallback((n: number) => setReviewCount(n), []);
  const onCommentCount = useCallback((n: number) => setCommentCount(n), []);

  const renderTab = (value: Tab, label: string, count: number, Icon: typeof Star) => {
    const active = tab === value;
    return (
      <Pressable
        style={[styles.tab, active && styles.tabActive]}
        onPress={() => setTab(value)}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        testID={`product-feedback-tab-${value}`}
      >
        <Icon
          size={16}
          color={active ? colors.textHeader : colors.textSupplementary}
          strokeWidth={2}
        />
        <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
          {label}
          {count > 0 ? ` (${count})` : ''}
        </Text>
      </Pressable>
    );
  };

  return (
    <View testID="product-feedback-tabs">
      <View style={styles.tabBar}>
        {renderTab('reviews', 'Reviews', reviewCount, Star)}
        {renderTab('comments', 'Comments', commentCount, MessageSquare)}
      </View>

      <View style={styles.body}>
        <View style={tab === 'reviews' ? styles.visible : styles.hidden}>
          <ProductReviews coord={coord} onRequestSignIn={onRequestSignIn} onCount={onReviewCount} />
        </View>
        <View style={tab === 'comments' ? styles.visible : styles.hidden}>
          <ProductComments
            root={commentRoot}
            onRequestSignIn={onRequestSignIn}
            onCount={onCommentCount}
          />
        </View>
      </View>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    tabBar: {
      flexDirection: 'row',
      gap: 24,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      marginBottom: 16,
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingBottom: 10,
      paddingTop: 4,
      marginBottom: -1,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabActive: {
      borderBottomColor: colors.brandPink,
    },
    tabLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSupplementary,
    },
    tabLabelActive: {
      color: colors.textHeader,
      fontWeight: '800',
    },
    body: {
      marginTop: 4,
    },
    visible: {
      display: 'flex',
    },
    hidden: {
      display: 'none',
    },
  });

export default ProductFeedbackTabs;
