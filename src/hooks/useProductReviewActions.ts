import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event as NostrEvent } from 'nostr-tools';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import { useTranslation } from '../contexts/LocaleContext';
import { usePublishProductFeedback } from './usePublishProductFeedback';
import type { ParsedReview } from '../utils/productReviews';

interface Params {
  /** Review coordinate `a:30402:<merchant>:<dTag>`. */
  coord: string;
  /** Signed-in account — an open edit or menu never survives a switch. */
  pubkey: string | null;
  /** The signed-in user's current review of this product, if any. */
  ownReview?: ParsedReview;
  addLocally: (review: NostrEvent) => void;
  hideLocally: (review: ParsedReview) => (deletion: NostrEvent | null) => void;
  refetch: () => void;
}

/**
 * Write / edit / delete your review (#1272). A review is addressable (kind
 * 31555, one per author per product), so Edit republishes the same address and
 * Delete publishes a NIP-09 kind-5 naming it (`a` + `e`). Once you have a
 * review the form collapses behind "Edit review" (and the "⋯" menu on your
 * review), reopening prefilled; after a publish it collapses again.
 */
export function useProductReviewActions({
  coord,
  pubkey,
  ownReview,
  addLocally,
  hideLocally,
  refetch,
}: Params) {
  const t = useTranslation();
  const { publishReview, deleteReview, publishing, canPublish } = usePublishProductFeedback();
  const [editing, setEditing] = useState(false);
  // The form holds typed input — keep it open even if the user's existing
  // review arrives late from the relays (it would otherwise collapse).
  const [dirty, setDirty] = useState(false);
  // Bumped to remount the form fresh (after a delete mid-edit).
  const [formGen, setFormGen] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  // `created_at` of our latest deletion of this review: a re-review must be
  // newer, or the deletion (inclusive of its own second) would cover it.
  const lastDeletionAt = useRef(0);

  useEffect(() => {
    setEditing(false);
    setDirty(false);
    setMenuOpen(false);
    lastDeletionAt.current = 0;
  }, [pubkey, coord]);

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

  const toast = useCallback(
    (type: 'success' | 'error', key: string) =>
      Toast.show({ type, text1: t(key), position: 'top', visibilityTime: 3000 }),
    [t],
  );

  const submit = useCallback(
    async (stars: number, content: string) => {
      const isUpdate = !!ownReview;
      try {
        const published = await publishReview({
          coord,
          stars,
          content,
          notBefore: lastDeletionAt.current + 1,
        });
        addLocally(published);
        setEditing(false);
        setDirty(false);
        toast('success', isUpdate ? 'market.reviews.updated' : 'market.reviews.posted');
        // Relays need a beat to serve the new event back; refresh shortly after.
        if (refetchTimer.current) clearTimeout(refetchTimer.current);
        refetchTimer.current = setTimeout(refetch, 1500);
      } catch {
        // The form keeps the draft; tell the user it didn't go out.
        toast('error', 'market.feedbackTabs.publishFailed');
      }
    },
    [ownReview, publishReview, coord, addLocally, toast, refetch],
  );

  const deleteNow = useCallback(
    async (review: ParsedReview) => {
      const settle = hideLocally(review);
      setEditing(false);
      setDirty(false);
      setFormGen((g) => g + 1);
      try {
        const deletion = await deleteReview(review, coord);
        lastDeletionAt.current = deletion.created_at;
        settle(deletion);
        toast('success', 'market.reviews.deleted');
      } catch {
        settle(null);
        toast('error', 'market.reviews.deleteFailed');
      }
    },
    [hideLocally, deleteReview, coord, toast],
  );

  const requestDelete = useCallback(
    (review: ParsedReview) => {
      setMenuOpen(false);
      Alert.alert(t('market.reviews.deleteTitle'), t('market.reviews.deleteBody'), [
        { text: t('market.reviews.cancel'), style: 'cancel' },
        {
          text: t('market.reviews.deleteConfirm'),
          style: 'destructive',
          onPress: () => void deleteNow(review),
        },
      ]);
    },
    [t, deleteNow],
  );

  const startEdit = useCallback(() => {
    setMenuOpen(false);
    setEditing(true);
  }, []);
  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDirty(false);
  }, []);
  const markDirty = useCallback(() => setDirty(true), []);
  const toggleMenu = useCallback(() => setMenuOpen((open) => !open), []);

  return {
    submit,
    publishing,
    canPublish,
    // No review yet: the form is the way in. With one: only while editing.
    formOpen: !ownReview || editing || dirty,
    /** The open form is changing an existing review (offers Cancel). */
    editing: (editing || dirty) && !!ownReview,
    formKey: `${coord}:${pubkey ?? ''}:${formGen}`,
    markDirty,
    startEdit,
    cancelEdit,
    menuOpen,
    toggleMenu,
    requestDelete,
  };
}
