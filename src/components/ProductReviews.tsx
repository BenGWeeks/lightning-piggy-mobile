import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr } from '../contexts/NostrContext';
import { useProductReviews } from '../hooks/useProductReviews';
import { usePublishProductFeedback } from '../hooks/usePublishProductFeedback';
import { relativeTime } from '../utils/relativeTime';
import type { ParsedReview } from '../utils/productReviews';
import type { Palette } from '../styles/palettes';
import {
  createProductReviewsStyles,
  type ProductReviewsStyles as Styles,
} from '../styles/ProductReviews.styles';
import { StarRating, StarRatingInput } from './StarRating';
import AuthorInline from './AuthorInline';

interface Props {
  /** Review coordinate `a:30402:<merchant>:<dTag>`. */
  coord: string;
  /** Called when a signed-out user tries to review — opens the login sheet. */
  onRequestSignIn: () => void;
  /** Reports the current review count up to the tab bar. */
  onCount?: (count: number) => void;
}

/** A single review row: author, stars, relative time and text. */
const ReviewItem: React.FC<{ review: ParsedReview; styles: Styles }> = ({ review, styles }) => (
  <View style={styles.item} testID={`product-review-${review.id || review.pubkey}`}>
    <View style={styles.itemHeader}>
      <AuthorInline pubkey={review.pubkey} size={26} />
      <Text style={styles.when}>{relativeTime(review.createdAt)}</Text>
    </View>
    <StarRating value={review.stars} size={14} />
    {review.text.length > 0 ? <Text style={styles.itemText}>{review.text}</Text> : null}
  </View>
);

/** Compose form (signed-in) or a sign-in prompt (signed-out). */
const ReviewForm: React.FC<{
  existing?: ParsedReview;
  styles: Styles;
  colors: Palette;
  onSubmit: (stars: number, content: string) => Promise<void>;
  submitting: boolean;
  canPublish: boolean;
  onRequestSignIn: () => void;
}> = ({ existing, styles, colors, onSubmit, submitting, canPublish, onRequestSignIn }) => {
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

  const ownReview = useMemo(() => {
    if (!pubkey) return undefined;
    // Hex pubkeys are case-insensitive — normalize both sides so an uppercase
    // hex from any relay/client still matches the current user's own review.
    const lower = pubkey.toLowerCase();
    return reviews.find((r) => r.pubkey.toLowerCase() === lower);
  }, [reviews, pubkey]);

  const onSubmit = async (stars: number, content: string) => {
    try {
      await publishReview({ coord, stars, content });
      // Relays need a beat to serve the new event back; refresh shortly after.
      // Track the timer so unmount can cancel it (see cleanup effect above).
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(refetch, 1500);
    } catch {
      // Swallow — a failed publish leaves the form intact to retry.
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

      <ReviewForm
        key={coord}
        existing={ownReview}
        styles={styles}
        colors={colors}
        onSubmit={onSubmit}
        submitting={publishing}
        canPublish={canPublish}
        onRequestSignIn={onRequestSignIn}
      />

      {error ? (
        <Text style={styles.state}>{t('market.reviews.loadError')}</Text>
      ) : loading && reviews.length === 0 ? (
        <ActivityIndicator style={styles.loading} color={colors.brandPink} />
      ) : reviews.length === 0 ? (
        <Text style={styles.state}>{t('market.reviews.empty')}</Text>
      ) : (
        reviews.map((r) => <ReviewItem key={r.id || r.pubkey} review={r} styles={styles} />)
      )}
    </View>
  );
};

export default ProductReviews;
