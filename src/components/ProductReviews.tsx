import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useNostr } from '../contexts/NostrContext';
import { useProductReviews } from '../hooks/useProductReviews';
import { usePublishProductFeedback } from '../hooks/usePublishProductFeedback';
import { relativeTime } from '../utils/relativeTime';
import type { ParsedReview } from '../utils/productReviews';
import type { Palette } from '../styles/palettes';
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
        <Text style={styles.signInText}>Sign in to write a review</Text>
      </TouchableOpacity>
    );
  }

  const submit = async () => {
    if (stars < 1) {
      setHint('Add a rating first');
      return;
    }
    setHint(null);
    await onSubmit(stars, content.trim());
  };

  return (
    <View style={styles.form} testID="product-review-form">
      <Text style={styles.formLabel}>{existing ? 'Update your review' : 'Write a review'}</Text>
      <StarRatingInput value={stars} onChange={onChangeStars} testID="product-review-star-input" />
      <TextInput
        style={styles.input}
        value={content}
        onChangeText={onChangeContent}
        placeholder="Share your experience (optional)"
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
          <Text style={styles.submitText}>{existing ? 'Update review' : 'Submit review'}</Text>
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
  const styles = useMemo(() => createStyles(colors), [colors]);
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

  const ownReview = useMemo(
    () => (pubkey ? reviews.find((r) => r.pubkey === pubkey) : undefined),
    [reviews, pubkey],
  );

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
            ({aggregate.count} {aggregate.count === 1 ? 'review' : 'reviews'})
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
        <Text style={styles.state}>{error}</Text>
      ) : loading && reviews.length === 0 ? (
        <ActivityIndicator style={styles.loading} color={colors.brandPink} />
      ) : reviews.length === 0 ? (
        <Text style={styles.state}>No reviews yet. Be the first to review this product!</Text>
      ) : (
        reviews.map((r) => <ReviewItem key={r.id || r.pubkey} review={r} styles={styles} />)
      )}
    </View>
  );
};

type Styles = ReturnType<typeof createStyles>;

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    aggregate: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 14,
    },
    aggregateAvg: { fontSize: 16, fontWeight: '800', color: colors.textHeader },
    aggregateCount: { fontSize: 13, color: colors.textSupplementary },
    form: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      gap: 10,
      marginBottom: 16,
    },
    formLabel: { fontSize: 14, fontWeight: '700', color: colors.textHeader },
    input: {
      minHeight: 64,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      padding: 10,
      color: colors.textBody,
      textAlignVertical: 'top',
      fontSize: 14,
    },
    hint: { fontSize: 12, color: colors.red },
    submit: {
      backgroundColor: colors.brandPink,
      borderRadius: 999,
      paddingVertical: 10,
      alignItems: 'center',
    },
    submitDisabled: { opacity: 0.6 },
    submitText: { color: colors.white, fontWeight: '800', fontSize: 14 },
    signInCard: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.divider,
      borderRadius: 12,
      paddingVertical: 18,
      alignItems: 'center',
      marginBottom: 16,
    },
    signInText: { color: colors.brandPink, fontWeight: '700', fontSize: 14 },
    item: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      gap: 6,
      marginBottom: 10,
    },
    itemHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    when: { fontSize: 12, color: colors.textSupplementary },
    itemText: { fontSize: 14, color: colors.textBody, lineHeight: 20 },
    state: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      paddingVertical: 20,
    },
    loading: { paddingVertical: 24 },
  });

export default ProductReviews;
