import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Event } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import type { RelayConfig } from '../types/nostr';
import {
  buildDmInboxEvent,
  buildRelayListEvent,
  isPublishableRelayUrl,
  RELAY_LIST_INDEXERS,
  relayListPublishTargets,
} from '../utils/relayListEvents';
import { fetchRelayList } from '../services/nostrService';
import {
  fetchDmInboxRelays,
  publishToRelays,
  type RelayPublishResult,
} from '../services/nostrRelayLists';

const norm = (url: string) => url.trim().replace(/\/+$/, '');

export type RelayListPublishOutcome =
  | { ok: true; results: RelayPublishResult[] }
  | {
      ok: false;
      error: 'empty' | 'no-write' | 'not-signed' | 'none-accepted';
      results?: RelayPublishResult[];
    };

/**
 * Draft-and-publish editor for the user's PUBLISHED relay lists — NIP-65
 * (kind 10002, where others read/write the user's notes) and the NIP-17 DM
 * inbox (kind 10050, where others send them DMs). Edits stay local until
 * published; publishing signs with the user's signer and reports per relay.
 */
export function useRelayListEditor() {
  const { pubkey, relays, nip65Relays, signEvent, applyPublishedRelayList } = useNostr();

  const [nip65Draft, setNip65Draft] = useState<RelayConfig[]>(nip65Relays);
  const [nip65Dirty, setNip65Dirty] = useState(false);
  // The cached list can be stale (e.g. edited in another client since): load
  // the CURRENT published list before allowing edits, so publishing never
  // overwrites a newer list with an old copy.
  const [nip65Loading, setNip65Loading] = useState(true);
  const [inboxBaseline, setInboxBaseline] = useState<string[]>([]);
  const [inboxDraft, setInboxDraft] = useState<string[]>([]);
  const [inboxDirty, setInboxDirty] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [publishing, setPublishing] = useState<'nip65' | 'inbox' | null>(null);

  // Follow the published list until the user starts editing.
  useEffect(() => {
    if (!nip65Dirty) setNip65Draft(nip65Relays);
  }, [nip65Relays, nip65Dirty]);

  const relayUrls = useMemo(() => relays.map((r) => r.url), [relays]);
  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    setNip65Loading(true);
    void fetchRelayList(pubkey, [...new Set([...relayUrls, ...RELAY_LIST_INDEXERS])]).then(
      (fresh) => {
        if (cancelled) return;
        if (fresh) void applyPublishedRelayList(pubkey, fresh);
        setNip65Loading(false);
      },
    );
    setInboxLoading(true);
    void fetchDmInboxRelays(pubkey, relayUrls).then((list) => {
      if (cancelled) return;
      setInboxBaseline(list ?? []);
      setInboxDraft((prev) => (inboxDirty ? prev : (list ?? [])));
      setInboxLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // Load once per identity; relay-set churn shouldn't clobber the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey]);

  const addNip65 = useCallback((input: string): boolean => {
    const url = norm(input);
    if (!isPublishableRelayUrl(url)) return false;
    setNip65Draft((prev) =>
      prev.some((r) => norm(r.url) === url) ? prev : [...prev, { url, read: true, write: true }],
    );
    setNip65Dirty(true);
    return true;
  }, []);

  const removeNip65 = useCallback((url: string) => {
    setNip65Draft((prev) => prev.filter((r) => norm(r.url) !== norm(url)));
    setNip65Dirty(true);
  }, []);

  const toggleNip65 = useCallback((url: string, mode: 'read' | 'write') => {
    setNip65Draft((prev) =>
      prev.map((r) => (norm(r.url) === norm(url) ? { ...r, [mode]: !r[mode] } : r)),
    );
    setNip65Dirty(true);
  }, []);

  const addInbox = useCallback((input: string): boolean => {
    const url = norm(input);
    if (!isPublishableRelayUrl(url)) return false;
    setInboxDraft((prev) => (prev.includes(url) ? prev : [...prev, url]));
    setInboxDirty(true);
    return true;
  }, []);

  const removeInbox = useCallback((url: string) => {
    setInboxDraft((prev) => prev.filter((u) => u !== norm(url)));
    setInboxDirty(true);
  }, []);

  const signAndPublish = useCallback(
    async (unsigned: ReturnType<typeof buildRelayListEvent>, targets: string[]) => {
      const signed = await signEvent(unsigned);
      if (!signed) return { ok: false as const, error: 'not-signed' as const };
      const results = await publishToRelays(signed as unknown as Event, targets);
      return results.some((r) => r.ok)
        ? { ok: true as const, results }
        : { ok: false as const, error: 'none-accepted' as const, results };
    },
    [signEvent],
  );

  const publishNip65 = useCallback(async (): Promise<RelayListPublishOutcome> => {
    if (!pubkey || nip65Loading) return { ok: false, error: 'not-signed' };
    const unsigned = buildRelayListEvent(nip65Draft);
    if (unsigned.tags.length === 0) return { ok: false, error: 'empty' };
    if (!nip65Draft.some((r) => r.write && isPublishableRelayUrl(r.url)))
      return { ok: false, error: 'no-write' };
    setPublishing('nip65');
    try {
      const outcome = await signAndPublish(
        unsigned,
        relayListPublishTargets(
          nip65Relays.map((r) => r.url),
          nip65Draft.map((r) => r.url),
        ),
      );
      if (outcome.ok) {
        await applyPublishedRelayList(pubkey, nip65Draft);
        setNip65Dirty(false);
      }
      return outcome;
    } finally {
      setPublishing(null);
    }
  }, [pubkey, nip65Loading, nip65Draft, nip65Relays, signAndPublish, applyPublishedRelayList]);

  const publishInbox = useCallback(async (): Promise<RelayListPublishOutcome> => {
    if (!pubkey) return { ok: false, error: 'not-signed' };
    const unsigned = buildDmInboxEvent(inboxDraft);
    if (unsigned.tags.length === 0) return { ok: false, error: 'empty' };
    setPublishing('inbox');
    try {
      // Senders look up the inbox list on the user's NIP-65 write relays.
      const writeRelays = nip65Relays.filter((r) => r.write).map((r) => r.url);
      const outcome = await signAndPublish(
        unsigned,
        relayListPublishTargets([...inboxBaseline, ...writeRelays], inboxDraft),
      );
      if (outcome.ok) {
        setInboxBaseline(inboxDraft);
        setInboxDirty(false);
      }
      return outcome;
    } finally {
      setPublishing(null);
    }
  }, [pubkey, inboxDraft, inboxBaseline, nip65Relays, signAndPublish]);

  return {
    nip65Draft,
    nip65Dirty,
    nip65Loading,
    addNip65,
    removeNip65,
    toggleNip65,
    publishNip65,
    inboxDraft,
    inboxDirty,
    inboxLoading,
    addInbox,
    removeInbox,
    publishInbox,
    publishing,
  };
}
