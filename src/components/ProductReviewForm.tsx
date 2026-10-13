import BrandedSpinner from './BrandedSpinner';
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import type { ParsedReview } from '../utils/productReviews';
import type { Palette } from '../styles/palettes';
import type { ProductReviewsStyles as Styles } from '../styles/ProductReviews.styles';
import { StarRatingInput } from './StarRating';

/** Compose form (signed-in) or a sign-in prompt (signed-out). */
const ProductReviewForm: React.FC<{
  existing?: ParsedReview;
  /** Editing an existing review: shows Cancel (collapses the form again). */
  onCancel?: () => void;
  /** Called on the first change, so the parent keeps a draft's form open. */
  onDirty?: () => void;
  styles: Styles;
  colors: Palette;
  onSubmit: (stars: number, content: string) => Promise<void>;
  submitting: boolean;
  canPublish: boolean;
  onRequestSignIn: () => void;
}> = ({
  existing,
  onCancel,
  onDirty,
  styles,
  colors,
  onSubmit,
  submitting,
  canPublish,
  onRequestSignIn,
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
    if (!touched) onDirty?.();
    setTouched(true);
    setStars(next);
  };
  const onChangeContent = (next: string) => {
    if (!touched) onDirty?.();
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
      <View style={styles.formHeader}>
        <Text style={styles.formLabel}>
          {existing ? t('market.reviews.updateLabel') : t('market.reviews.write')}
        </Text>
        {onCancel ? (
          <TouchableOpacity
            onPress={onCancel}
            accessibilityRole="button"
            hitSlop={8}
            testID="product-review-edit-cancel"
          >
            <Text style={styles.formCancel}>{t('market.reviews.cancel')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
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
          <BrandedSpinner size="small" onGradient />
        ) : (
          <Text style={styles.submitText}>
            {existing ? t('market.reviews.submitUpdate') : t('market.reviews.submit')}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

export default ProductReviewForm;
