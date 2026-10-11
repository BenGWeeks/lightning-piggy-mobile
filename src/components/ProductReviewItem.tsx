import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { relativeTime } from '../utils/relativeTime';
import type { ParsedReview } from '../utils/productReviews';
import type { ProductReviewsStyles as Styles } from '../styles/ProductReviews.styles';
import { StarRating } from './StarRating';
import AuthorInline from './AuthorInline';
import { FeedbackActionsButton, FeedbackActionsRow } from './FeedbackActions';

interface Props {
  review: ParsedReview;
  styles: Styles;
  /** The signed-in user wrote it — only then are Edit / Delete offered. */
  isMine: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onDelete: (review: ParsedReview) => void;
}

/**
 * One review row: author, stars, relative time and text. Your own review gets
 * a "⋯" button (and long-press) revealing Edit / Delete inline (#1272).
 */
const ProductReviewItem: React.FC<Props> = ({
  review,
  styles,
  isMine,
  menuOpen,
  onToggleMenu,
  onEdit,
  onDelete,
}) => (
  <Pressable
    style={styles.item}
    testID={`product-review-${review.id || review.pubkey}`}
    onLongPress={isMine ? onToggleMenu : undefined}
  >
    <View style={styles.itemHeader}>
      <AuthorInline pubkey={review.pubkey} size={26} />
      <View style={styles.itemMeta}>
        <Text style={styles.when}>{relativeTime(review.createdAt)}</Text>
        {isMine ? (
          <FeedbackActionsButton
            kind="review"
            id={review.id}
            open={menuOpen}
            onToggle={onToggleMenu}
          />
        ) : null}
      </View>
    </View>
    <StarRating value={review.stars} size={14} />
    {review.text.length > 0 ? <Text style={styles.itemText}>{review.text}</Text> : null}
    {isMine && menuOpen ? (
      <FeedbackActionsRow kind="review" onEdit={onEdit} onDelete={() => onDelete(review)} />
    ) : null}
  </Pressable>
);

export default React.memo(ProductReviewItem);
