import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr } from '../contexts/NostrContext';
import { useProductReviews } from '../hooks/useProductReviews';
import { usePublishProductFeedback } from '../hooks/usePublishProductFeedback';
import { relativeTime } from '../utils/relativeTime';
import { STARS_MAX, type ParsedReview } from '../utils/productReviews';
import { FEEDBACK_PAGE_SIZE } from '../utils/marketFeedback';
import type { Palette } from '../styles/palettes';
import {
  createProductReviewsStyles,
  type ProductReviewsStyles as Styles,
} from '../styles/ProductReviews.styles';
import { StarRating, StarRatingInput } from './StarRating';
import AuthorInline from './AuthorInline';
import Toast from './BrandedToast';

interface Props {
  /** Review coordinate `a:30402:<merchant>:<dTag>`. */
  coord: string;
  /** Called when a signed-out user tries to review — opens the login sheet. */
  onRequestSignIn: () => void;
  /** Reports the current review count up to the tab bar. */
  onCount?: (count: number) => void;
}

/** A single review row: author, stars, relative time and text. */
const ReviewItem = React.memo(function ReviewItem({
  review,
  styles,
}: {
  review: ParsedReview;
  styles: Styles;
}) {
  return (
    <View style={styles.item} testID={`product-review-${review.id || review.pubkey}`}>
      <View style={styles.itemHeader}>
        <AuthorInline pubkey={review.pubkey} size={26} />
        <Text style={styles.when}>{relativeTime(review.createdAt)}</Text>
      </View>
      <StarRating value={review.stars} size={14} />
      {review.text.length > 0 ? <Text style={styles.itemText}>{review.text}</Text> : null}
    </View>
  );
});

/** Compose form (signed-in) or a sign-in prompt (signed-out). */
const ReviewForm: React.FC<{
  existing?: ParsedReview;
  styles: Styles;
  colors: Palette;
  onSubmit: (stars: number, content: string) => Promise<void>;
  submitting: boolean;
  canPublish: boolean;
  onRequestSignIn: () => void;
  /** Shown only while editing an existing review — collapses the form again. */
  onCancel?: () => void;
}> = ({
  existing,
  styles,
  colors,
  onSubmit,
  submitting,
  canPublish,
  onRequestSignIn,
  onCancel,
}) => {
  const t = useTranslation();
  const existingStars = existing ? Math.round(existing.stars) : 0;
  const existingText = existing?.text ?? '';
  const [stars, setStars] = useState(existingStars);
  const [content, setContent] = useState(existingText);
  const [hint, setHint] = useState<string | null>(null);
  // Whether the user has started editing. Once they have, we STOP adopting the
  // loaded/updated existing review so a late relay response can never clobber
  // their in-progress input (Copilot review on #948).
  const [touched, setTouched] = useState(false);

  // Adopt the user's own review into the form only while it is still pristine
  // (they haven't typed yet). This prefills the form when the existing review
  // arrives after mount without overwriting edits already in progress.
  useEffect(() => {
    if (touched) return;
    setStars(existingStars);
    setContent(existingText);
  }, [existingStars, existingText, touched]);

  const onChangeStars = (next: number) => {
    setTouched(true);
    setStars(next);
  };
  const onChangeContent = (next: string) => {
    setTouched(true);
    setContent(next);
  };

  if (!canPublish) {
    return (
      <TouchableOpacity
        style={styles.signInCard}
        onPress={onRequestSignIn}
        testID="product-review-signin"
        activeOpacity={0.8}
      >
        <Text style={styles.signInText}>{t('market.reviews.signIn')}</Text>
      </TouchableOpacity>
    );
  }

  const submit = async () => {
    if (stars < 1) {
      setHint(t('market.reviews.addRating'));
      return;
    }
    setHint(null);
    await onSubmit(stars, content.trim());
  };

  return (
    <View style={styles.form} testID="product-review-form">
      <Text style={styles.formLabel}>
        {existing ? t('market.reviews.updateLabel') : t('market.reviews.write')}
      </Text>
      <StarRatingInput value={stars} onChange={onChangeStars} testID="product-review-star-input" />
      <TextInput
        style={styles.input}
        value={content}
        onChangeText={onChangeContent}
        placeholder={t('market.reviews.placeholder')}
        placeholderTextColor={colors.textSupplementary}
        multiline
        testID="product-review-text"
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TouchableOpacity
        style={[styles.submit, submitting && styles.submitDisabled]}
        onPress={submit}
        disabled={submitting}
        testID="product-review-submit"
        activeOpacity={0.8}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} size="small" />
        ) : (
          <Text style={styles.submitText}>
            {existing ? t('market.reviews.submitUpdate') : t('market.reviews.submit')}
          </Text>
        )}
      </TouchableOpacity>
      {onCancel ? (
        <TouchableOpacity
          style={styles.cancel}
          onPress={onCancel}
          disabled={submitting}
          accessibilityRole="button"
          testID="product-review-cancel"
        >
          <Text style={styles.cancelText}>{t('market.reviews.cancelEdit')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

/** Collapsed state once the user has reviewed: a note plus "Edit review". */
const OwnReviewSummary: React.FC<{ styles: Styles; onEdit: () => void }> = ({ styles, onEdit }) => {
  const t = useTranslation();
  return (
    <View style={styles.ownSummary} testID="product-review-own">
      <Text style={styles.ownSummaryText}>{t('market.reviews.yours')}</Text>
      <TouchableOpacity
        style={styles.editButton}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={t('market.reviews.edit')}
        testID="product-review-edit"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.editText}>{t('market.reviews.edit')}</Text>
      </TouchableOpacity>
    </View>
  );
};

/**
 * Reviews tab body: aggregate stars, a compose form (or sign-in prompt) and
 * the list of reviews (kind 31555). Pure logic lives in `utils/productReviews`.
 */
const ProductReviews: React.FC<Props> = ({ coord, onRequestSignIn, onCount }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createProductReviewsStyles(colors), [colors]);
  const { pubkey } = useNostr();
  const { reviews, aggregate, loading, error, refetch } = useProductReviews(coord);
  const { publishReview, publishing, canPublish } = usePublishProductFeedback();

  // Pending post-publish refetch timer, cleared on unmount so a late fire can
  // never call refetch (and setState) after this component is gone (Copilot
  // review on #948).
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    },
    [],
  );

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

  // Once the user has a review, the form collapses to a short summary with an
  // "Edit review" button; editing reopens it prefilled. `posted` bridges the
  // gap between a successful publish and the relay serving the review back
  // (the refetch below), so the form doesn't reopen empty in the meantime.
  const [editing, setEditing] = useState(false);
  const [posted, setPosted] = useState<ParsedReview | undefined>(undefined);
  // The draft never carries across identities or products (screens stay
  // mounted through account switches).
  useEffect(() => {
    setEditing(false);
    setPosted(undefined);
  }, [coord, pubkey]);
  const existing = ownReview ?? posted;
  const startEditing = useCallback(() => setEditing(true), []);
  const stopEditing = useCallback(() => setEditing(false), []);

  const onSubmit = async (stars: number, content: string) => {
    const wasUpdate = existing !== undefined;
    try {
      await publishReview({ coord, stars, content });
      setPosted({
        id: '',
        pubkey: pubkey ?? '',
        rating: stars / STARS_MAX,
        stars,
        categories: [],
        text: content,
        createdAt: Math.floor(Date.now() / 1000),
      });
      setEditing(false);
      Toast.show({
        type: 'success',
        text1: t(wasUpdate ? 'market.reviews.updated' : 'market.reviews.posted'),
        position: 'top',
        visibilityTime: 2500,
      });
      // Relays need a beat to serve the new event back; refresh shortly after.
      // Track the timer so unmount can cancel it (see cleanup effect above).
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(refetch, 1500);
    } catch {
      // The form keeps the draft; tell the user it didn't go out.
      Toast.show({
        type: 'error',
        text1: t('market.feedbackTabs.publishFailed'),
        position: 'top',
        visibilityTime: 3000,
      });
    }
  };

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

      {existing && canPublish && !editing ? (
        <OwnReviewSummary styles={styles} onEdit={startEditing} />
      ) : (
        <ReviewForm
          // Keyed on the identity too: the account switcher keeps screens
          // mounted, and a draft must never carry over to another pubkey.
          key={`${coord}:${pubkey ?? ''}`}
          existing={existing}
          styles={styles}
          colors={colors}
          onSubmit={onSubmit}
          submitting={publishing}
          canPublish={canPublish}
          onRequestSignIn={onRequestSignIn}
          onCancel={existing ? stopEditing : undefined}
        />
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
            <ReviewItem key={r.id || r.pubkey} review={r} styles={styles} />
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
