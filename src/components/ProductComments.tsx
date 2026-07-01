import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import type { Event as NostrEvent } from 'nostr-tools';
import { useThemeColors } from '../contexts/ThemeContext';
import { useProductComments } from '../hooks/useProductComments';
import { usePublishProductFeedback } from '../hooks/usePublishProductFeedback';
import { relativeTime } from '../utils/relativeTime';
import type { CommentRoot } from '../utils/productComments';
import type { Palette } from '../styles/palettes';
import AuthorInline from './AuthorInline';

interface Props {
  /** The kind-30402 product event the thread is rooted on. */
  root: CommentRoot;
  /** Called when a signed-out user tries to comment — opens the login sheet. */
  onRequestSignIn: () => void;
  /** Reports the current top-level comment count up to the tab bar. */
  onCount?: (count: number) => void;
}

const CommentItem: React.FC<{ comment: NostrEvent; styles: Styles }> = ({ comment, styles }) => (
  <View style={styles.item} testID={`product-comment-${comment.id}`}>
    <View style={styles.itemHeader}>
      <AuthorInline pubkey={comment.pubkey} size={26} />
      <Text style={styles.when}>{relativeTime(comment.created_at ?? 0)}</Text>
    </View>
    <Text style={styles.itemText}>{comment.content}</Text>
  </View>
);

/**
 * Comments tab body: a compose box (or sign-in prompt) and the list of
 * top-level comments (NIP-22 kind 1111). Pure logic lives in
 * `utils/productComments`.
 */
const ProductComments: React.FC<Props> = ({ root, onRequestSignIn, onCount }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { topLevel, loading, error, refetch } = useProductComments(root);
  const { publishComment, publishing, canPublish } = usePublishProductFeedback();
  const [content, setContent] = useState('');

  useEffect(() => {
    onCount?.(topLevel.length);
  }, [topLevel.length, onCount]);

  const submit = async () => {
    if (!content.trim()) return;
    try {
      await publishComment({ root, content });
      setContent('');
      setTimeout(refetch, 1500);
    } catch {
      // Swallow — leave the text intact so the user can retry.
    }
  };

  return (
    <View testID="product-comments">
      {canPublish ? (
        <View style={styles.form} testID="product-comment-form">
          <TextInput
            style={styles.input}
            value={content}
            onChangeText={setContent}
            placeholder="Add a comment"
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
              <Text style={styles.submitText}>Post comment</Text>
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
          <Text style={styles.signInText}>Sign in to comment</Text>
        </TouchableOpacity>
      )}

      {error ? (
        <Text style={styles.state}>{error}</Text>
      ) : loading && topLevel.length === 0 ? (
        <ActivityIndicator style={styles.loading} color={colors.brandPink} />
      ) : topLevel.length === 0 ? (
        <Text style={styles.state}>No comments yet. Be the first to start the discussion!</Text>
      ) : (
        topLevel.map((c) => <CommentItem key={c.id} comment={c} styles={styles} />)
      )}
    </View>
  );
};

type Styles = ReturnType<typeof createStyles>;

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    form: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      gap: 10,
      marginBottom: 16,
    },
    input: {
      minHeight: 56,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      padding: 10,
      color: colors.textBody,
      textAlignVertical: 'top',
      fontSize: 14,
    },
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

export default ProductComments;
