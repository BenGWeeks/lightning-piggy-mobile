import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useNostr } from '../contexts/NostrContext';
import { useProductComments } from '../hooks/useProductComments';
import { useProductCommentActions } from '../hooks/useProductCommentActions';
import type { CommentRoot } from '../utils/productComments';
import { FEEDBACK_PAGE_SIZE } from '../utils/marketFeedback';
import { createProductCommentsStyles } from '../styles/ProductComments.styles';
import ProductCommentItem from './ProductCommentItem';

interface Props {
  /** The kind-30402 product event the thread is rooted on. */
  root: CommentRoot;
  /** Called when a signed-out user tries to comment — opens the login sheet. */
  onRequestSignIn: () => void;
  /** Reports the current top-level comment count up to the tab bar. */
  onCount?: (count: number) => void;
}

/**
 * Comments tab body: a compose box (or sign-in prompt) and the list of
 * top-level comments (NIP-22 kind 1111), with Edit / Delete on your own
 * (#1272). Pure logic lives in `utils/productComments` and
 * `utils/commentEdits`; the compose + edit/delete orchestration in
 * `useProductCommentActions`.
 */
const ProductComments: React.FC<Props> = ({ root, onRequestSignIn, onCount }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createProductCommentsStyles(colors), [colors]);
  const { topLevel, loading, error, refetch, addLocally, hideLocally } = useProductComments(root);
  const { pubkey } = useNostr();
  const {
    content,
    setContent,
    inputRef,
    submit,
    publishing,
    canPublish,
    isEditing,
    cancelEdit,
    menuFor,
    toggleMenu,
    startEdit,
    requestDelete,
  } = useProductCommentActions({ root, pubkey, addLocally, hideLocally, refetch });

  useEffect(() => {
    onCount?.(topLevel.length);
  }, [topLevel.length, onCount]);

  // Page the rows: the list sits in the product page's outer ScrollView, so a
  // large thread must not mount every row + profile lookup at once.
  const [visibleCount, setVisibleCount] = useState(FEEDBACK_PAGE_SIZE);
  const hiddenCount = Math.max(0, topLevel.length - visibleCount);

  return (
    <View testID="product-comments">
      {canPublish ? (
        <View style={styles.form} testID="product-comment-form">
          {isEditing ? (
            <View style={styles.editingBar} testID="product-comment-editing">
              <Text style={styles.editingText}>{t('market.comments.editing')}</Text>
              <TouchableOpacity
                onPress={cancelEdit}
                accessibilityRole="button"
                hitSlop={8}
                testID="product-comment-edit-cancel"
              >
                <Text style={styles.editingCancel}>{t('market.comments.cancel')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={content}
            onChangeText={setContent}
            placeholder={t('market.comments.placeholder')}
            placeholderTextColor={colors.textSupplementary}
            multiline
            testID="product-comment-text"
          />
          <TouchableOpacity
            style={[styles.submit, publishing && styles.submitDisabled]}
            onPress={submit}
            disabled={publishing}
            testID="product-comment-submit"
            activeOpacity={0.8}
          >
            {publishing ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitText}>
                {isEditing ? t('market.comments.save') : t('market.comments.post')}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.signInCard}
          onPress={onRequestSignIn}
          testID="product-comment-signin"
          activeOpacity={0.8}
        >
          <Text style={styles.signInText}>{t('market.comments.signIn')}</Text>
        </TouchableOpacity>
      )}

      {error ? (
        <View>
          <Text style={styles.state}>{t('market.comments.loadError')}</Text>
          <TouchableOpacity
            style={styles.showMore}
            onPress={refetch}
            accessibilityRole="button"
            testID="product-comments-retry"
          >
            <Text style={styles.showMoreText}>{t('market.feedbackTabs.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : loading && topLevel.length === 0 ? (
        <ActivityIndicator style={styles.loading} color={colors.brandPink} />
      ) : topLevel.length === 0 ? (
        <Text style={styles.state}>{t('market.comments.empty')}</Text>
      ) : (
        <>
          {topLevel.slice(0, visibleCount).map((c) => (
            <ProductCommentItem
              key={c.id}
              comment={c}
              styles={styles}
              isMine={!!pubkey && c.pubkey === pubkey}
              menuOpen={menuFor === c.id}
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
              testID="product-comments-show-more"
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

export default ProductComments;
