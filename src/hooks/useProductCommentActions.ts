import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event as NostrEvent } from 'nostr-tools';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import { useTranslation } from '../contexts/LocaleContext';
import { usePublishProductFeedback } from './usePublishProductFeedback';
import type { CommentRoot } from '../utils/productComments';
import {
  beginCommentEdit,
  canSaveCommentEdit,
  endCommentEditFor,
  updateCommentEditText,
  type CommentEditDraft,
} from '../utils/commentEditDraft';

interface Params {
  root: CommentRoot;
  /** Signed-in account — a draft, edit or open menu never survives a switch. */
  pubkey: string | null;
  addLocally: (comment: NostrEvent) => void;
  hideLocally: (id: string) => () => void;
  refetch: () => void;
}

/**
 * The new-comment composer and the "⋯" actions on your own comments (#1272):
 * post, Edit IN PLACE (#1524 — the comment's own card becomes the editor; Save
 * publishes the replacement + a kind-5 for the old version, and the top
 * composer stays a plain new-comment box), and Delete (confirm, hide at once,
 * publish a NIP-09 kind-5; roll back if no relay took it). The edit-state
 * transitions live in `utils/commentEditDraft`; reconciliation of what readers
 * see in `utils/commentEdits`.
 */
export function useProductCommentActions({
  root,
  pubkey,
  addLocally,
  hideLocally,
  refetch,
}: Params) {
  const t = useTranslation();
  const { publishComment, editComment, deleteComment, canPublish } = usePublishProductFeedback();
  // The new-comment draft (top composer).
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  // The comment being edited in place — at most one at a time.
  const [editDraft, setEditDraft] = useState<CommentEditDraft>(null);
  // The ref rejects repeat calls synchronously, even before React re-renders.
  const pendingEdits = useRef(new Set<string>());
  const [savingEditIds, setSavingEditIds] = useState<ReadonlySet<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // The account switcher keeps screens mounted — a draft typed under one
  // identity must never be published by the next (or survive logout).
  useEffect(() => {
    setContent('');
    setEditDraft(null);
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

  /** Turn `comment`'s card into the editor (cancelling any other open edit). */
  const startEdit = useCallback((comment: NostrEvent) => {
    setMenuFor(null);
    setEditDraft(beginCommentEdit(comment));
  }, []);

  const setEditText = useCallback((text: string) => {
    setEditDraft((prev) => updateCommentEditText(prev, text));
  }, []);

  const cancelEdit = useCallback(() => setEditDraft(null), []);

  /** Publish the in-place edit of `original`. The card stays open on failure. */
  const saveEdit = useCallback(
    async (original: NostrEvent, text: string) => {
      if (pendingEdits.current.has(original.id) || !canSaveCommentEdit(original.content, text)) {
        return;
      }
      pendingEdits.current.add(original.id);
      setSavingEditIds(new Set(pendingEdits.current));
      try {
        const result = await editComment(original, text);
        // Only end THIS edit — the user may have moved on to another comment
        // while it was publishing.
        setEditDraft((prev) => endCommentEditFor(prev, original.id));
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
        // The edit is kept in the card; tell the user it didn't go out.
        showError('market.comments.editFailed');
      } finally {
        pendingEdits.current.delete(original.id);
        setSavingEditIds(new Set(pendingEdits.current));
      }
    },
    [editComment, addLocally, hideLocally, t, showError],
  );

  const deleteNow = useCallback(
    async (comment: NostrEvent) => {
      const undo = hideLocally(comment.id);
      // Deleting the comment being edited ends the edit.
      setEditDraft((prev) => endCommentEditFor(prev, comment.id));
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

  /** Post the top composer's text as a new comment. */
  const submit = useCallback(async () => {
    if (!content.trim() || posting) return;
    setPosting(true);
    try {
      const posted = await publishComment({ root, content });
      // Only clear the box if it still holds what was posted.
      setContent((prev) => (prev === content ? '' : prev));
      addLocally(posted);
      scheduleRefetch();
    } catch {
      // The draft is kept; tell the user it didn't go out.
      showError('market.feedbackTabs.publishFailed');
    } finally {
      setPosting(false);
    }
  }, [content, posting, publishComment, root, addLocally, scheduleRefetch, showError]);

  return {
    content,
    setContent,
    submit,
    posting,
    canPublish,
    editDraft,
    savingEditIds,
    startEdit,
    setEditText,
    cancelEdit,
    saveEdit,
    menuFor,
    toggleMenu,
    requestDelete,
  };
}
