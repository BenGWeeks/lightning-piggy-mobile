import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event as NostrEvent } from 'nostr-tools';
import type { TextInput } from 'react-native';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import { useTranslation } from '../contexts/LocaleContext';
import { usePublishProductFeedback } from './usePublishProductFeedback';
import type { CommentRoot } from '../utils/productComments';

interface Composer {
  text: string;
  /** The comment being edited, and the draft the composer held before. */
  editing: { comment: NostrEvent; priorDraft: string } | null;
}

const EMPTY_COMPOSER: Composer = { text: '', editing: null };

/** Leave edit mode, giving the composer back its earlier draft. */
const stopEditing = (prev: Composer): Composer =>
  prev.editing ? { text: prev.editing.priorDraft, editing: null } : prev;

interface Params {
  root: CommentRoot;
  /** Signed-in account — a draft, edit or open menu never survives a switch. */
  pubkey: string | null;
  addLocally: (comment: NostrEvent) => void;
  hideLocally: (id: string) => () => void;
  refetch: () => void;
}

/**
 * The comment composer and the "⋯" actions on your own comments (#1272):
 * post, Edit (the composer is borrowed, prefilled, and Save publishes the
 * replacement + a kind-5 for the old version), and Delete (confirm, hide at
 * once, publish a NIP-09 kind-5; roll back if no relay took it). Reconciliation
 * of what readers see lives in `utils/commentEdits`.
 */
export function useProductCommentActions({
  root,
  pubkey,
  addLocally,
  hideLocally,
  refetch,
}: Params) {
  const t = useTranslation();
  const { publishComment, editComment, deleteComment, publishing, canPublish } =
    usePublishProductFeedback();
  // Draft text and edit state live together so every update is one pure step.
  const [composer, setComposer] = useState<Composer>(EMPTY_COMPOSER);
  const { text: content, editing } = composer;
  const setContent = useCallback((text: string) => setComposer((prev) => ({ ...prev, text })), []);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  // The account switcher keeps screens mounted — a draft typed under one
  // identity must never be published by the next (or survive logout).
  useEffect(() => {
    setComposer(EMPTY_COMPOSER);
    setMenuFor(null);
  }, [pubkey]);

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
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(refetch, 1500);
  }, [refetch]);

  const showError = useCallback(
    (key: string) =>
      Toast.show({ type: 'error', text1: t(key), position: 'top', visibilityTime: 3000 }),
    [t],
  );

  const toggleMenu = useCallback((id: string) => {
    setMenuFor((open) => (open === id ? null : id));
  }, []);

  const startEdit = useCallback((comment: NostrEvent) => {
    setMenuFor(null);
    // Keep whatever was being typed so Cancel can give it back.
    setComposer((prev) => ({
      text: comment.content,
      editing: { comment, priorDraft: prev.editing ? prev.editing.priorDraft : prev.text },
    }));
    inputRef.current?.focus();
  }, []);

  const cancelEdit = useCallback(() => setComposer(stopEditing), []);

  const deleteNow = useCallback(
    async (comment: NostrEvent) => {
      const undo = hideLocally(comment.id);
      // Deleting the comment being edited ends the edit.
      setComposer((prev) => (prev.editing?.comment.id === comment.id ? stopEditing(prev) : prev));
      try {
        await deleteComment(comment);
        Toast.show({
          type: 'success',
          text1: t('market.comments.deleted'),
          position: 'top',
          visibilityTime: 3000,
        });
      } catch {
        undo();
        showError('market.comments.deleteFailed');
      }
    },
    [hideLocally, deleteComment, t, showError],
  );

  const requestDelete = useCallback(
    (comment: NostrEvent) => {
      setMenuFor(null);
      Alert.alert(t('market.comments.deleteTitle'), t('market.comments.deleteBody'), [
        { text: t('market.comments.cancel'), style: 'cancel' },
        {
          text: t('market.comments.deleteConfirm'),
          style: 'destructive',
          onPress: () => void deleteNow(comment),
        },
      ]);
    },
    [t, deleteNow],
  );

  const submit = useCallback(async () => {
    if (!content.trim()) return;
    if (editing) {
      const original = editing.comment;
      try {
        const result = await editComment(original, content);
        // Only end THIS edit — the user may have moved on to another comment
        // while it was publishing.
        setComposer((prev) =>
          prev.editing?.comment.id === original.id ? stopEditing(prev) : prev,
        );
        if (!result) return; // unchanged text — nothing to publish
        addLocally(result.replacement);
        hideLocally(original.id);
        Toast.show({
          type: 'success',
          text1: t('market.comments.updated'),
          position: 'top',
          visibilityTime: 3000,
        });
      } catch {
        // The edit is kept in the composer; tell the user it didn't go out.
        showError('market.comments.editFailed');
      }
      return;
    }
    try {
      const posted = await publishComment({ root, content });
      // An edit started while this was publishing keeps the composer, but
      // must not hand the just-posted text back as its "prior draft".
      setComposer((prev) => {
        if (!prev.editing) return EMPTY_COMPOSER;
        if (prev.editing.priorDraft !== content) return prev;
        return { ...prev, editing: { ...prev.editing, priorDraft: '' } };
      });
      addLocally(posted);
      scheduleRefetch();
    } catch {
      // The draft is kept; tell the user it didn't go out.
      showError('market.feedbackTabs.publishFailed');
    }
  }, [
    content,
    editing,
    editComment,
    addLocally,
    hideLocally,
    t,
    showError,
    publishComment,
    root,
    scheduleRefetch,
  ]);

  return {
    content,
    setContent,
    inputRef,
    submit,
    publishing,
    canPublish,
    isEditing: editing !== null,
    cancelEdit,
    menuFor,
    toggleMenu,
    startEdit,
    requestDelete,
  };
}
