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
 *   full `sendGroupMessage` round-trip. On failure, unlike the 1:1 delivery-
 *   store model (which keeps a red-tick bubble), the group path has no per-relay
 *   breakdown store today, so we: (a) show a BrandedAlert (existing behaviour,
 *   unchanged) AND (b) remove the just-appended optimistic row from storage/state
 *   so a never-published message doesn't linger in the thread.
 *   The 'Saved on relay, not on device' case in `appendGroupMessage` is
 *   unchanged — it fires only when the relay send SUCCEEDED but local storage
 *   threw, so no removal is needed there.
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
  // The in-memory row is painted immediately; storage is async. Returns the
  // appended row so the failure path can reference its id for removal.
  const appendOptimisticGroupRow = useCallback(
    async (text: string): Promise<{ ok: boolean; row: GroupMessage | null }> => {
      if (!group || !myPubkey) return { ok: false, row: null };
      const local: GroupMessage = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        senderPubkey: myPubkey,
        text,
        createdAt: Math.floor(Date.now() / 1000),
      };
      // Paint the bubble immediately in UI state — storage is async.
      setMessages((prev) => [...prev, local]);
      notifyGroupMessage(group.id, local);
      setTimeout(scrollToEnd, 0);
      try {
        const next = await appendGroupMessage(group.id, local);
        setMessages(next);
        return { ok: true, row: local };
      } catch (err) {
        if (__DEV__) console.warn('[GroupConversationScreen] appendGroupMessage failed:', err);
        Alert.alert(
          'Saved on relay, not on device',
          'Your message was sent, but we could not save it locally. Try again to refresh, or restart the app.',
        );
        // Storage failed but the send already completed — keep the in-memory
        // row; return ok:false so the caller knows storage failed, but we do
        // NOT remove the row (the message got to the relay).
        return { ok: false, row: local };
      }
    },
    [group, myPubkey, setMessages, scrollToEnd],
  );

  // Remove a previously-appended optimistic row on a complete send failure.
  // Only called when the relay send itself failed (not the local-storage path),
  // so the message truly never went out. Updates both state and storage.
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

      // Optimistic bubble: painted synchronously from onRumorReady, before
      // any signing. rowRef is captured from the async appendOptimisticGroupRow
      // resolution so the failure path can remove the correct row (#1033).
      let rowRef: GroupMessage | null = null;

      const result = await sendGroupMessage(
        {
          groupId: group.id,
          subject: group.name,
          memberPubkeys: group.memberPubkeys,
          text,
        },
        {
          onRumorReady: () => {
            // Fire-and-forget: the async storage write happens in the background;
            // the in-memory row is visible instantly. We capture rowRef so the
            // failure path below can remove it if the send ultimately fails.
            void appendOptimisticGroupRow(text).then(({ row }) => {
              rowRef = row;
            });
          },
        },
      );

      if (!result.success) {
        Alert.alert('Send failed', result.error ?? 'Unknown error');
        // Remove the optimistic row we painted before signing — the message
        // never went out. Yield one microtask first so appendOptimisticGroupRow
        // has a chance to resolve and populate rowRef (it's nearly instant,
        // but the signing round-trip that preceded this failure gave it ample
        // time; the yield is a safety net for edge cases).
        await Promise.resolve();
        if (rowRef) await removeOptimisticRow((rowRef as GroupMessage).id);
        return false;
      }
      return true;
    },
    [group, myPubkey, sendGroupMessage, appendOptimisticGroupRow, removeOptimisticRow],
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

      let rowRef: GroupMessage | null = null;

      const result = await sendGroupMessage(
        {
          groupId: group.id,
          subject: group.name,
          memberPubkeys: group.memberPubkeys,
          file,
        },
        {
          onRumorReady: () => {
            void appendOptimisticGroupRow(fileText).then(({ row }) => {
              rowRef = row;
            });
          },
        },
      );

      if (!result.success) {
        const what = kind === 'image' ? 'image' : 'voice note';
        Alert.alert('Send failed', result.error ?? `Could not send ${what}.`);
        await Promise.resolve();
        if (rowRef) await removeOptimisticRow((rowRef as GroupMessage).id);
        return false;
      }
      return true;
    },
    [group, myPubkey, sendGroupMessage, appendOptimisticGroupRow, removeOptimisticRow],
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

      let rowRef: GroupMessage | null = null;

      const result = await sendGroupMessage(
        {
          groupId: group.id,
          subject: group.name,
          memberPubkeys: group.memberPubkeys,
          text: payload,
        },
        {
          onRumorReady: () => {
            void appendOptimisticGroupRow(payload).then(({ row }) => {
              rowRef = row;
            });
          },
        },
      );

      if (!result.success) {
        // On failure: remove the optimistic row so the thread stays clean.
        await Promise.resolve();
        if (rowRef) await removeOptimisticRow((rowRef as GroupMessage).id);
        return { success: false, error: result.error ?? 'Send failed' };
      }
      return { success: true };
    },
    [group, myPubkey, sendGroupMessage, appendOptimisticGroupRow, removeOptimisticRow],
  );

  // `sendText` is also exposed so poll-share / poll-vote can post arbitrary
  // serialised bodies through the same optimistic-append path as the composer.
  // It's additionally re-exposed as `resendText` for the message-info sheet's
  // Re-publish (#856), mirroring the 1:1 hook — a re-publish is a fresh group
  // send (publish + optimistic row).
  return { ...actions, sendText, handleSendInvoiceToGroup, resendText: sendText };
}
