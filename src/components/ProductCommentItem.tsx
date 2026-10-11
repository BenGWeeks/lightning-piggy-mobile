import React from 'react';
import { View, Text, Pressable } from 'react-native';
import type { Event as NostrEvent } from 'nostr-tools';
import { useTranslation } from '../contexts/LocaleContext';
import { relativeTime } from '../utils/relativeTime';
import { isEditedComment } from '../utils/commentEdits';
import type { ProductCommentsStyles as Styles } from '../styles/ProductComments.styles';
import AuthorInline from './AuthorInline';
import { FeedbackActionsButton, FeedbackActionsRow } from './FeedbackActions';

interface Props {
  comment: NostrEvent;
  styles: Styles;
  /** The signed-in user wrote it — only then are Edit / Delete offered. */
  isMine: boolean;
  menuOpen: boolean;
  onToggleMenu: (id: string) => void;
  onEdit: (comment: NostrEvent) => void;
  onDelete: (comment: NostrEvent) => void;
}

/**
 * One product comment row. Your own comments get a "⋯" button (and
 * long-press) that reveals Edit / Delete inline (#1272); an edited comment
 * shows an "Edited" marker beside its time.
 */
const ProductCommentItem: React.FC<Props> = ({
  comment,
  styles,
  isMine,
  menuOpen,
  onToggleMenu,
  onEdit,
  onDelete,
}) => {
  const t = useTranslation();
  const edited = isEditedComment(comment);
  return (
    <Pressable
      style={styles.item}
      testID={`product-comment-${comment.id}`}
      onLongPress={isMine ? () => onToggleMenu(comment.id) : undefined}
    >
      <View style={styles.itemHeader}>
        <AuthorInline pubkey={comment.pubkey} size={26} />
        <View style={styles.itemMeta}>
          <Text style={styles.when}>
            {relativeTime(comment.created_at ?? 0)}
            {edited ? ` · ${t('market.comments.editedMarker')}` : ''}
          </Text>
          {isMine ? (
            <FeedbackActionsButton
              kind="comment"
              id={comment.id}
              open={menuOpen}
              onToggle={() => onToggleMenu(comment.id)}
            />
          ) : null}
        </View>
      </View>
      <Text style={styles.itemText}>{comment.content}</Text>
      {isMine && menuOpen ? (
        <FeedbackActionsRow
          kind="comment"
          onEdit={() => onEdit(comment)}
          onDelete={() => onDelete(comment)}
        />
      ) : null}
    </Pressable>
  );
};

export default React.memo(ProductCommentItem);
