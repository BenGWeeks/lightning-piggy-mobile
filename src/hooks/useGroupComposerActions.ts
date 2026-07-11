import React, { useCallback, useMemo } from 'react';
import { Alert } from '../components/BrandedAlert';
import { useNostr, notifyGroupMessage } from '../contexts/NostrContext';
import {
  appendGroupMessage,
  removeGroupMessage,
  type GroupMessage,
} from '../services/groupMessagesStorageService';
import { encodeEncryptedFileUrl } from '../utils/encryptedFileUrl';
import type { EncryptedUpload } from '../services/imageUploadService';
import type { Group } from '../types/groups';
import { useComposerActions } from './useComposerActions';

/**
 * Group GroupConversationScreen composer actions. A thin wrapper over the
 * shared `useComposerActions` (#235): it provides the group send strategy
 * (`sendGroupMessage` text / kind-15 file + an optimistic `local_…`-row append
 * with scroll) and re-exposes the shared handlers, plus the group-only
 * `handleSendInvoiceToGroup`. The 1:1 sibling is `useConversationComposerActions`.
 *
 * Optimistic-send semantics (#1033):
 *   The group path now mirrors the 1:1 path — the optimistic bubble is painted
 *   IMMEDIATELY when `onRumorReady` fires (before any signing), not after the
 *   full `sendGroupMessage` round-trip. The row is captured synchronously and
 *   the async storage write is exposed as a settle-promise, so outcomes stay
 *   truthful regardless of how the two races interleave:
 *   - Relay send FAILED → send-failure Alert; await the storage write, then
 *     remove the row from state+storage (a never-published message must not
 *     linger, and removal after the write settles can't be raced by a late
 *     `setMessages` from the write).
 *   - Relay send OK, storage write FAILED → 'Saved on relay, not on device'
 *     Alert (only now is "your message was sent" true) and return false so the
 *     caller keeps the draft for retry — the pre-#1033 semantics.
 */
export function useGroupComposerActions(params: {
  group: Group | undefined;
  draft: string;
  setDraft: (value: string) => void;
  setMessages: React.Dispatch<React.SetStateAction<GroupMessage[]>>;
  scrollToEnd: () => void;
  setAttachPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setGifPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setContactPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setVoiceSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const {
    group,
    draft,
    setDraft,
    setMessages,
    scrollToEnd,
    setAttachPanelOpen,
    setGifPickerOpen,
    setContactPickerOpen,
    setVoiceSheetOpen,
  } = params;

  const { sendGroupMessage, pubkey: myPubkey } = useNostr();

  // Optimistically append a `local_…` row (dup window vs the inbound self-wrap
  // is a known follow-up, PR #227) and scroll to it.
  //
  // With the #1033 optimistic-bubble change this is called from inside the
  // `onRumorReady` hook (synchronously, before signing), not after the send.
  // The in-memory row is painted immediately and returned synchronously so the
  // failure path always has its id; the async storage write is exposed as
  // `persisted` (never rejects) so callers can await it and judge the outcome
  // once the relay send has resolved.
  const appendOptimisticGroupRow = useCallback(
    (text: string): { row: GroupMessage; persisted: Promise<boolean> } | null => {
      if (!group || !myPubkey) return null;
      const local: GroupMessage = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        senderPubkey: myPubkey,
        text,
        createdAt: Math.floor(Date.now() / 1000),
      };
      // Paint the bubble immediately in UI state — storage is async. The
      // cross-screen `notifyGroupMessage` event, however, must NOT fire yet:
      // `GroupConversationScreen`/`GroupsContext` listeners reload from
      // AsyncStorage when it fires, so notifying before the append settles
      // can clobber the just-painted row with a storage snapshot that
      // doesn't include it yet (flicker). Notify only once the write has
      // actually landed, mirroring the pre-#1033 ordering.
      setMessages((prev) => [...prev, local]);
      setTimeout(scrollToEnd, 0);
      const persisted = appendGroupMessage(group.id, local)
        .then((next) => {
          setMessages(next);
          notifyGroupMessage(group.id, local);
          return true;
        })
        .catch((err: unknown) => {
          if (__DEV__) console.warn('[GroupConversationScreen] appendGroupMessage failed:', err);
          return false;
        });
      return { row: local, persisted };
    },
    [group, myPubkey, setMessages, scrollToEnd],
  );

  // Relay send succeeded but the local storage write didn't — only here is
  // "your message was sent" actually true, so the alert lives with the caller
  // outcome, not inside appendOptimisticGroupRow.
  const alertSavedOnRelayOnly = useCallback((): void => {
    Alert.alert(
      'Saved on relay, not on device',
      'Your message was sent, but we could not save it locally. Try again to refresh, or restart the app.',
    );
  }, []);

  // Remove a previously-appended optimistic row on a complete send failure.
  // Only called when the relay send itself failed (not the local-storage path),
  // so the message truly never went out. Updates in-memory state directly via
  // the filter above (never from removeGroupMessage's return value — see that
  // function's doc: it rejects on a storage error rather than returning `[]`,
  // specifically so a transient AsyncStorage blip can't be mistaken for "the
  // thread is now empty"). A storage-write failure here just means the
  // retraction didn't persist; the row is still gone from the UI, and we
  // swallow the error since there's no user-facing action to take on a
  // failed cleanup of an already-failed send.
  const removeOptimisticRow = useCallback(
    async (rowId: string): Promise<void> => {
      if (!group) return;
      setMessages((prev) => prev.filter((m) => m.id !== rowId));
      try {
        await removeGroupMessage(group.id, rowId);
      } catch (err) {
        if (__DEV__) console.warn('[GroupConversationScreen] removeGroupMessage failed:', err);
      }
    },
    [group, setMessages],
  );

  const sendText = useCallback(
    async (text: string): Promise<boolean> => {
      if (!group || !myPubkey) return false;

      // Optimistic bubble: painted synchronously from onRumorReady, before any
      // signing — the row id is captured synchronously (a `.current` box, not
      // narrowed away by TS closure analysis) so failure cleanup is reliable.
      const optimistic: { current: { row: GroupMessage; persisted: Promise<boolean> } | null } = {
        current: null,
      };

      const result = await sendGroupMessage(
        {
          groupId: group.id,
          subject: group.name,
          memberPubkeys: group.memberPubkeys,
          text,
        },
        {
          onRumorReady: () => {
            optimistic.current = appendOptimisticGroupRow(text);
          },
        },
      );

      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Unknown error');
        // Remove the optimistic row we painted before signing — the message
        // never went out. Await the storage write first so its trailing
        // setMessages can't re-add the row after removal.
        if (optimistic.current) {
          await optimistic.current.persisted;
          await removeOptimisticRow(optimistic.current.row.id);
        }
        return false;
      }
      // Sent, but not saved locally: keep the draft (return false) so the user
      // can retry/refresh — pre-#1033 semantics.
      if (optimistic.current && !(await optimistic.current.persisted)) {
        alertSavedOnRelayOnly();
        return false;
      }
      return true;
    },
    [
      group,
      myPubkey,
      sendGroupMessage,
      appendOptimisticGroupRow,
      removeOptimisticRow,
      alertSavedOnRelayOnly,
    ],
  );

  const sendFile = useCallback(
    async (file: EncryptedUpload, kind: 'voice' | 'image'): Promise<boolean> => {
      if (!group || !myPubkey) return false;

      const fileText = encodeEncryptedFileUrl({
        url: file.url,
        mime: file.mime,
        keyHex: file.keyHex,
        nonceHex: file.nonceHex,
      });

      const optimistic: { current: { row: GroupMessage; persisted: Promise<boolean> } | null } = {
        current: null,
      };

      const result = await sendGroupMessage(
        {
          groupId: group.id,
          subject: group.name,
          memberPubkeys: group.memberPubkeys,
          file,
        },
        {
          onRumorReady: () => {
            optimistic.current = appendOptimisticGroupRow(fileText);
          },
        },
      );

      if (!result.success) {
        const what = kind === 'image' ? 'image' : 'voice note';
        Alert.alert('Send failed', result.error ?? `Could not send ${what}.`);
        if (optimistic.current) {
          await optimistic.current.persisted;
          await removeOptimisticRow(optimistic.current.row.id);
        }
        return false;
      }
      // Sent-but-not-saved: return false so the voice sheet / attach panel
      // stays open for retry, matching sendText's draft-keeping semantics.
      if (optimistic.current && !(await optimistic.current.persisted)) {
        alertSavedOnRelayOnly();
        return false;
      }
      return true;
    },
    [
      group,
      myPubkey,
      sendGroupMessage,
      appendOptimisticGroupRow,
      removeOptimisticRow,
      alertSavedOnRelayOnly,
    ],
  );

  // Preflight so the shared hook can skip an expensive encrypt+upload (voice /
  // image) when there's no valid group target to send to.
  const canSend = useCallback(() => !!group && !!myPubkey, [group, myPubkey]);

  // Memoise the strategy so the shared hook's callbacks (which depend on it)
  // keep stable identities across renders.
  const strategy = useMemo(() => ({ sendText, sendFile, canSend }), [sendText, sendFile, canSend]);

  const actions = useComposerActions({
    strategy,
    draft,
    setDraft,
    setAttachPanelOpen,
    setGifPickerOpen,
    setContactPickerOpen,
    setVoiceSheetOpen,
  });

  // Group-only: ReceiveSheet hands us a bolt11 via `onSendToGroup`. Post it
  // directly (NOT via the strategy's sendText, which raises its own Alert on
  // failure — ReceiveSheet shows a Toast too, and stacking both reads as a bug).
  const handleSendInvoiceToGroup = useCallback(
    async (payload: string): Promise<{ success: boolean; error?: string }> => {
      if (!group || !myPubkey) return { success: false, error: 'Group unavailable.' };

      const optimistic: { current: { row: GroupMessage; persisted: Promise<boolean> } | null } = {
        current: null,
      };

      const result = await sendGroupMessage(
        {
          groupId: group.id,
          subject: group.name,
          memberPubkeys: group.memberPubkeys,
          text: payload,
        },
        {
          onRumorReady: () => {
            optimistic.current = appendOptimisticGroupRow(payload);
          },
        },
      );

      if (!result.success) {
        // On failure: remove the optimistic row so the thread stays clean
        // (await the storage write first so it can't re-add the row).
        if (optimistic.current) {
          await optimistic.current.persisted;
          await removeOptimisticRow(optimistic.current.row.id);
        }
        return { success: false, error: result.error ?? 'Send failed' };
      }
      // Sent, but not saved locally: relay send is still a success (matches
      // pre-#1033 semantics — the invoice was published), but the user needs
      // to know it wasn't persisted, or a later reload can silently lose it.
      if (optimistic.current && !(await optimistic.current.persisted)) {
        alertSavedOnRelayOnly();
      }
      return { success: true };
    },
    [
      group,
      myPubkey,
      sendGroupMessage,
      appendOptimisticGroupRow,
      removeOptimisticRow,
      alertSavedOnRelayOnly,
    ],
  );

  // `sendText` is also exposed so poll-share / poll-vote can post arbitrary
  // serialised bodies through the same optimistic-append path as the composer.
  // It's additionally re-exposed as `resendText` for the message-info sheet's
  // Re-publish (#856), mirroring the 1:1 hook — a re-publish is a fresh group
  // send (publish + optimistic row).
  return { ...actions, sendText, handleSendInvoiceToGroup, resendText: sendText };
}
