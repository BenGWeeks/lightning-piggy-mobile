import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { filterMessagesByProtocol, type DmProtocol } from '../utils/dmProtocol';
import { subscribeDmMessages } from '../contexts/nostrEventBus';
import { keepPendingLocalRows, reconcileDeliveryStatus } from '../contexts/nostrDmCache';
import type { ConversationMessage } from '../contexts/nostrContextTypes';
import type { ConversationMessageInput } from '../utils/conversationItems';
import type { DeliveryStatus } from '../utils/dmDeliveryStatus';
import { createAbortReplacer } from '../utils/abortReplace';

// Owns the conversation thread's data lifecycle (#868): read-through paint from
// the ingested store, the background relay top-up, abort-on-unmount, and
// single-flight of re-entrant refreshes. Lifted out of ConversationScreen so the
// screen is composition — and so the load orchestration is independently
// readable. State (`messages`, `loading`, `refreshing`) lives here because the
// load loop and the live-sub effect are the only writers; the screen consumes
// the result and the composer hook still appends optimistic rows via setMessages.

export interface UseConversationLoaderParams {
  pubkey: string;
  protocol: DmProtocol;
  isLoggedIn: boolean;
  fetchConversation: (
    otherPubkey: string,
    opts?: { signal?: AbortSignal; protocol?: 'nip04' | 'nip17' },
  ) => Promise<ConversationMessage[]>;
  loadInitialConversation: (
    otherPubkey: string,
    protocol?: 'nip04' | 'nip17',
  ) => Promise<ConversationMessage[]>;
  persistDeliveryStatuses: (
    otherPubkey: string,
    statusById: Record<string, DeliveryStatus>,
  ) => Promise<void>;
}

export interface UseConversationLoaderResult {
  messages: ConversationMessageInput[];
  setMessages: React.Dispatch<React.SetStateAction<ConversationMessageInput[]>>;
  loading: boolean;
  refreshing: boolean;
  handleRefresh: () => Promise<void>;
}

export function useConversationLoader({
  pubkey,
  protocol,
  isLoggedIn,
  fetchConversation,
  loadInitialConversation,
  persistDeliveryStatuses,
}: UseConversationLoaderParams): UseConversationLoaderResult {
  const [messages, setMessages] = useState<ConversationMessageInput[]>([]);
  // Mirror of `messages` for reads outside render (e.g. the delivery-tick
  // reconcile in `load`, so persistence runs as a side-effect rather than
  // inside a setMessages updater — Copilot #858).
  const messagesRef = useRef<ConversationMessageInput[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Mount/unmount tracker so the async `load()` below can bail when the user
  // navigates back mid-fetch. Without this, every back-press during the 6-12 s
  // cold fetchConversation still runs the full decrypt + persist chain on the
  // unmounted component, wasting JS thread time that could have been responding
  // to input. Declared BEFORE `load` because `load`'s body closes over it.
  const isMountedRef = useRef(true);
  // Single-flight + abort (#868): the controller for the in-flight conversation
  // fetch. `load` aborts-and-replaces it on every call, so a re-entry (the mount
  // effect firing again, a live-sub re-fetch, or a second pull) can't stack a
  // second decrypt loop on the JS thread; the unmount cleanup aborts it so a
  // back-press mid-fetch cancels the relay query + decrypt instead of letting it
  // drain. At most one in-flight conversation fetch per screen instance.
  // Lazily created on first access so the factory doesn't run on every render
  // (and only once under StrictMode's double-invoke). Stable for the instance.
  const fetchAbortRef = useRef<ReturnType<typeof createAbortReplacer> | null>(null);
  if (fetchAbortRef.current === null) {
    fetchAbortRef.current = createAbortReplacer();
  }
  useEffect(() => {
    isMountedRef.current = true;
    // Snapshot the replacer for the cleanup closure — it's created once and
    // never reassigned, but copying it satisfies react-hooks/exhaustive-deps.
    const replacer = fetchAbortRef.current;
    return () => {
      isMountedRef.current = false;
      replacer?.abort();
    };
  }, []);

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (!isLoggedIn) {
        setLoading(false);
        return;
      }
      // Single-flight: cancel any in-flight fetch and replace it with this one,
      // so a re-entrant load can never run two decrypt loops at once (#868).
      // Non-null: the ref is initialized during render before any load can run.
      const signal = fetchAbortRef.current!.begin();
      // Read-through (#868): paint from the union of the per-conversation cache
      // AND the encrypted store the inbox is built from — so a DM the inbox
      // already ingested shows within one frame and the thread is never behind
      // the preview. The relay fetch below is a background top-up, not a
      // precondition for showing anything. Only show the spinner if BOTH are
      // empty (a true cold open with nothing ingested yet).
      // Per-protocol window (#1118): the store + fetch read only this thread,
      // so another protocol's newer history can't use up its slice.
      const storeProtocol = protocol === 'marmot' ? undefined : protocol;
      const initial = filterMessagesByProtocol(
        await loadInitialConversation(pubkey, storeProtocol),
        protocol,
      );
      if (signal.aborted || !isMountedRef.current) return;
      if (initial.length > 0) {
        setMessages((prev) =>
          keepPendingLocalRows(filterMessagesByProtocol(prev, protocol), initial),
        );
        setLoading(false);
      } else if (showSpinner) {
        setLoading(true);
      }
      try {
        const conv = filterMessagesByProtocol(
          await fetchConversation(pubkey, { signal, protocol: storeProtocol }),
          protocol,
        );
        // A superseding load (or unmount) aborted this fetch — drop the result
        // so we don't setState on a cancelled / stale pass.
        if (signal.aborted) return;
        // If the user navigated away while the fetch was in flight, don't fire
        // state updates — those would either trigger a re-render on an unmounted
        // component (React warning) or land on the *next* thread that inherits
        // this instance. Check the ref and bail.
        if (isMountedRef.current) {
          // Carry any delivery tick (#856) from the current in-memory rows onto
          // the fetched list, so a just-sent bubble keeps its tick even when the
          // relay echo lands before the optimistic row's async cache write
          // commits (the on-disk merge would miss it in that race). Computed
          // against messagesRef (not inside the setMessages updater) so the
          // AsyncStorage write is a plain side-effect — keeps the updater pure
          // and StrictMode-safe (Copilot #858).
          const previous = filterMessagesByProtocol(messagesRef.current, protocol);
          const reconciled = keepPendingLocalRows(
            previous,
            reconcileDeliveryStatus(previous, conv),
          );
          // Durably write the reconciled ticks back to the conv cache, keyed by
          // the (now real-id) row id, so the tick survives a cold restart —
          // fetchConversation persisted the echo rows WITHOUT delivery when it
          // won the race against the optimistic local- write.
          const statusById: Record<string, DeliveryStatus> = {};
          for (const m of reconciled) {
            if (m.deliveryStatus && !m.id.startsWith('local-')) {
              statusById[m.id] = m.deliveryStatus;
            }
          }
          void persistDeliveryStatuses(pubkey, statusById);
          setMessages(reconciled);
        }
      } finally {
        // Leave the spinner state to whichever load is current — an aborted /
        // superseded pass must not clear a spinner the replacing load owns.
        if (isMountedRef.current && !signal.aborted) {
          setLoading(false);
        }
      }
    },
    [
      isLoggedIn,
      fetchConversation,
      loadInitialConversation,
      persistDeliveryStatuses,
      pubkey,
      protocol,
    ],
  );

  // Live updates: NostrContext fires `subscribeDmMessages` after a kind-1059
  // wrap arrives via the long-lived relay sub and decrypts to a 1:1 rumor for
  // this thread's peer (#349). Re-fetching the conversation is cheap because the
  // new wrap is now in the persistent NIP-17 cache, so fetchConversation
  // short-circuits the relay round-trip and the thread re-renders within a tick.
  useFocusEffect(
    useCallback(() => {
      if (!pubkey) return;
      // Catch up with messages received while this screen was blurred.
      void load(true);
      const target = pubkey.toLowerCase();
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = subscribeDmMessages((partnerPubkey) => {
        if (partnerPubkey !== target) return;
        // Coalesce relay bursts into one read instead of one load per event.
        if (refreshTimer) return;
        refreshTimer = setTimeout(() => {
          refreshTimer = undefined;
          void load(false);
        }, 150);
      });
      return () => {
        clearTimeout(refreshTimer);
        unsubscribe();
      };
    }, [pubkey, load]),
  );

  // Generation guard so overlapping pull-to-refreshes don't drop the spinner
  // early (Copilot #869): `load` is single-flight and aborts the previous
  // fetch, so an earlier call resolves as soon as it's superseded. Only the
  // newest refresh clears `refreshing`; superseded ones leave it to the winner.
  const refreshGenRef = useRef(0);
  const handleRefresh = useCallback(async () => {
    const gen = ++refreshGenRef.current;
    setRefreshing(true);
    try {
      await load(false);
    } finally {
      if (refreshGenRef.current === gen) {
        setRefreshing(false);
      }
    }
  }, [load]);

  // Route changes can reuse a mounted screen: never paint the old protocol while loading.
  const threadMessages = useMemo(
    () => filterMessagesByProtocol(messages, protocol),
    [messages, protocol],
  );
  return { messages: threadMessages, setMessages, loading, refreshing, handleRefresh };
}
