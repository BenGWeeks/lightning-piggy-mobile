import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr } from '../contexts/NostrContext';
import { useProductReviews } from '../hooks/useProductReviews';
import { useProductReviewActions } from '../hooks/useProductReviewActions';
import { FEEDBACK_PAGE_SIZE } from '../utils/marketFeedback';
import { createProductReviewsStyles } from '../styles/ProductReviews.styles';
import { StarRating } from './StarRating';
import ProductReviewForm from './ProductReviewForm';
import ProductReviewItem from './ProductReviewItem';

interface Props {
  /** Review coordinate `a:30402:<merchant>:<dTag>`. */
  coord: string;
  /** Called when a signed-out user tries to review — opens the login sheet. */
  onRequestSignIn: () => void;
  /** Reports the current review count up to the tab bar. */
  onCount?: (count: number) => void;
}

/**
 * Reviews tab body: aggregate stars, a compose form (or sign-in prompt) and
 * the list of reviews (kind 31555), with Edit / Delete on your own (#1272).
 * Pure logic lives in `utils/productReviews` + `utils/nip09`; the
 * write/edit/delete orchestration in `useProductReviewActions`.
 */
const ProductReviews: React.FC<Props> = ({ coord, onRequestSignIn, onCount }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createProductReviewsStyles(colors), [colors]);
  const { pubkey } = useNostr();
  const { reviews, aggregate, loading, error, refetch, addLocally, hideLocally } =
    useProductReviews(coord);

  useEffect(() => {
    onCount?.(aggregate.count);
  }, [aggregate.count, onCount]);

  // Page the rows: the list sits in the product page's outer ScrollView, so a
  // large review set must not mount every row + profile lookup at once.
  const [visibleCount, setVisibleCount] = useState(FEEDBACK_PAGE_SIZE);
  const hiddenCount = Math.max(0, reviews.length - visibleCount);

  const ownReview = useMemo(() => {
    if (!pubkey) return undefined;
    // Hex pubkeys are case-insensitive — normalize both sides so an uppercase
    // hex from any relay/client still matches the current user's own review.
    const lower = pubkey.toLowerCase();
    return reviews.find((r) => r.pubkey.toLowerCase() === lower);
  }, [reviews, pubkey]);

  const {
    submit,
    publishing,
    canPublish,
    formOpen,
    editing,
    formKey,
    markDirty,
    startEdit,
    cancelEdit,
    menuOpen,
    toggleMenu,
    requestDelete,
  } = useProductReviewActions({ coord, pubkey, ownReview, addLocally, hideLocally, refetch });

  return (
    <View testID="product-reviews">
      {aggregate.count > 0 ? (
        <View style={styles.aggregate}>
          <StarRating value={aggregate.average} size={18} />
          <Text style={styles.aggregateAvg}>{aggregate.average.toFixed(1)}</Text>
          <Text style={styles.aggregateCount}>
            ({t('market.reviews.count', { count: aggregate.count })})
          </Text>
        </View>
      ) : null}

      {formOpen || !canPublish ? (
        <ProductReviewForm
          // Keyed on the identity too: the account switcher keeps screens
          // mounted, and a draft must never carry over to another pubkey (and
          // a delete mid-edit starts a fresh form).
          key={formKey}
          existing={ownReview}
          onDirty={markDirty}
          onCancel={editing ? cancelEdit : undefined}
          styles={styles}
          colors={colors}
          onSubmit={submit}
          submitting={publishing}
          canPublish={canPublish}
          onRequestSignIn={onRequestSignIn}
        />
      ) : (
        // You've reviewed it: collapse the form behind "Edit review".
        <View style={styles.yoursCard} testID="product-review-yours">
          <Text style={styles.yoursText}>{t('market.reviews.yours')}</Text>
          <TouchableOpacity
            style={styles.yoursButton}
            onPress={startEdit}
            accessibilityRole="button"
            testID="product-review-edit-open"
          >
            <Text style={styles.yoursButtonText}>{t('market.reviews.editOpen')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {error ? (
        <View>
          <Text style={styles.state}>{t('market.reviews.loadError')}</Text>
          <TouchableOpacity
            style={styles.showMore}
            onPress={refetch}
            accessibilityRole="button"
            testID="product-reviews-retry"
          >
            <Text style={styles.showMoreText}>{t('market.feedbackTabs.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : loading && reviews.length === 0 ? (
        <ActivityIndicator style={styles.loading} color={colors.brandPink} />
      ) : reviews.length === 0 ? (
        <Text style={styles.state}>{t('market.reviews.empty')}</Text>
      ) : (
        <>
          {reviews.slice(0, visibleCount).map((r) => (
            <ProductReviewItem
              key={r.id || r.pubkey}
              review={r}
              styles={styles}
              isMine={r === ownReview}
              menuOpen={r === ownReview && menuOpen}
              onToggleMenu={toggleMenu}
              onEdit={startEdit}
              onDelete={requestDelete}
            />
          ))}
          {hiddenCount > 0 ? (
            <TouchableOpacity
              style={styles.showMore}
              onPress={() => setVisibleCount((c) => c + FEEDBACK_PAGE_SIZE)}
              accessibilityRole="button"
              testID="product-reviews-show-more"
            >
              <Text style={styles.showMoreText}>
                {t('market.feedbackTabs.showMore', { count: hiddenCount })}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}
    </View>
  );
};

export default ProductReviews;
