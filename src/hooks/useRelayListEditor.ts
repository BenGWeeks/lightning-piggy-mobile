import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Event } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import type { RelayConfig } from '../types/nostr';
import { fetchRelayList } from '../services/nostrService';
import {
  buildDmInboxEvent,
  buildRelayListEvent,
  dmInboxRelaysFromTags,
  isPublishableRelayUrl,
  RELAY_LIST_INDEXERS,
  relayListFromTags,
  relayListPublishTargets,
  type UnsignedEvent,
} from '../utils/relayListEvents';
import {
  fetchDmInboxRelays,
  fetchNewest,
  publishToRelays,
  type RelayPublishResult,
} from '../services/nostrRelayLists';

const norm = (url: string) => url.trim().replace(/\/+$/, '');

export type RelayListPublishOutcome =
  | { ok: true; results: RelayPublishResult[] }
  | {
      ok: false;
      error: 'empty' | 'no-write' | 'not-signed' | 'none-accepted' | 'busy';
      results?: RelayPublishResult[];
    };

/**
 * Draft-and-publish editor for the user's PUBLISHED relay lists — NIP-65
 * (kind 10002, where others read/write the user's notes) and the NIP-17 DM
 * inbox (kind 10050, where others send them DMs). Edits stay local until
 * published; publishing signs with the user's signer and reports per relay.
 *
 * Editing is frozen while the current lists load (the NEWEST version, so a
 * stale copy can't overwrite a list changed in another client) and while a
 * publish is in flight (so no edit is lost when the result is adopted).
 */
export function useRelayListEditor() {
  const { pubkey, relays, nip65Relays, signEvent, applyPublishedRelayList, applyPublishedDmInbox } =
    useNostr();

  const [nip65Draft, setNip65Draft] = useState<RelayConfig[]>(nip65Relays);
  const [nip65Dirty, setNip65Dirty] = useState(false);
  const [nip65Loading, setNip65Loading] = useState(true);
  const [inboxBaseline, setInboxBaseline] = useState<string[]>([]);
  const [inboxDraft, setInboxDraft] = useState<string[]>([]);
  const [inboxDirty, setInboxDirty] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [publishing, setPublishing] = useState<'nip65' | 'inbox' | null>(null);

  // Follow the published list until the user starts editing.
  useEffect(() => {
    if (!nip65Dirty) setNip65Draft(nip65Relays);
  }, [nip65Relays, nip65Dirty]);

  const relayUrls = useMemo(() => relays.map((r) => r.url), [relays]);
  useEffect(() => {
    if (!pubkey) return;
    let cancelled = false;
    const sources = [...new Set([...relayUrls, ...RELAY_LIST_INDEXERS])];
    setNip65Loading(true);
    setInboxLoading(true);
    void fetchNewest<RelayConfig[]>((onLatest) =>
      fetchRelayList(pubkey, sources, { onLatest }),
    ).then(async (fresh) => {
      if (cancelled) return;
      if (fresh) await applyPublishedRelayList(pubkey, fresh);
      if (!cancelled) setNip65Loading(false);
    });
    void fetchNewest<string[]>((onLatest) =>
      fetchDmInboxRelays(pubkey, sources, { onLatest }),
    ).then((list) => {
      if (cancelled) return;
      setInboxBaseline(list ?? []);
      setInboxDraft(list ?? []);
      setInboxLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // Load once per identity; relay-set churn shouldn't reload mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey]);

  const nip65Editable = !nip65Loading && publishing === null;
  const inboxEditable = !inboxLoading && publishing === null;

  const addNip65 = useCallback(
    (input: string): boolean => {
      const url = norm(input);
      if (!nip65Editable || !isPublishableRelayUrl(url)) return false;
      setNip65Draft((prev) =>
        prev.some((r) => norm(r.url) === url) ? prev : [...prev, { url, read: true, write: true }],
      );
      setNip65Dirty(true);
      return true;
    },
    [nip65Editable],
  );

  const removeNip65 = useCallback(
    (url: string) => {
      if (!nip65Editable) return;
      setNip65Draft((prev) => prev.filter((r) => norm(r.url) !== norm(url)));
      setNip65Dirty(true);
    },
    [nip65Editable],
  );

  const toggleNip65 = useCallback(
    (url: string, mode: 'read' | 'write') => {
      if (!nip65Editable) return;
      setNip65Draft((prev) =>
        prev.map((r) => (norm(r.url) === norm(url) ? { ...r, [mode]: !r[mode] } : r)),
      );
      setNip65Dirty(true);
    },
    [nip65Editable],
  );

  const addInbox = useCallback(
    (input: string): boolean => {
      const url = norm(input);
      if (!inboxEditable || !isPublishableRelayUrl(url)) return false;
      setInboxDraft((prev) => (prev.includes(url) ? prev : [...prev, url]));
      setInboxDirty(true);
      return true;
    },
    [inboxEditable],
  );

  const removeInbox = useCallback(
    (url: string) => {
      if (!inboxEditable) return;
      setInboxDraft((prev) => prev.filter((u) => u !== norm(url)));
      setInboxDirty(true);
    },
    [inboxEditable],
  );

  /** Sign, publish, and return the event as signed (so callers adopt exactly that). */
  const signAndPublish = useCallback(
    async (unsigned: UnsignedEvent, targets: string[]) => {
      const signed = await signEvent(unsigned);
      if (!signed) return { outcome: { ok: false as const, error: 'not-signed' as const } };
      const results = await publishToRelays(signed as unknown as Event, targets);
      const outcome: RelayListPublishOutcome = results.some((r) => r.ok)
        ? { ok: true, results }
        : { ok: false, error: 'none-accepted', results };
      return { outcome, tags: signed.tags };
    },
    [signEvent],
  );

  const publishNip65 = useCallback(async (): Promise<RelayListPublishOutcome> => {
    if (!pubkey || nip65Loading) return { ok: false, error: 'not-signed' };
    if (publishing) return { ok: false, error: 'busy' };
    const unsigned = buildRelayListEvent(nip65Draft);
    if (unsigned.tags.length === 0) return { ok: false, error: 'empty' };
    if (!unsigned.tags.some((t) => !t[2] || t[2] === 'write'))
      return { ok: false, error: 'no-write' };
    setPublishing('nip65');
    try {
      const { outcome, tags } = await signAndPublish(
        unsigned,
        relayListPublishTargets(
          nip65Relays.map((r) => r.url),
          nip65Draft.map((r) => r.url),
        ),
      );
      if (outcome.ok && tags) {
        // Adopt exactly what was signed (non-public rows were dropped).
        const published = relayListFromTags(tags);
        await applyPublishedRelayList(pubkey, published);
        setNip65Draft(published);
        setNip65Dirty(false);
      }
      return outcome;
    } finally {
      setPublishing(null);
    }
  }, [
    pubkey,
    nip65Loading,
    publishing,
    nip65Draft,
    nip65Relays,
    signAndPublish,
    applyPublishedRelayList,
  ]);

  const publishInbox = useCallback(async (): Promise<RelayListPublishOutcome> => {
    if (!pubkey || inboxLoading) return { ok: false, error: 'not-signed' };
    if (publishing) return { ok: false, error: 'busy' };
    const unsigned = buildDmInboxEvent(inboxDraft);
    if (unsigned.tags.length === 0) return { ok: false, error: 'empty' };
    setPublishing('inbox');
    try {
      // Senders look up the inbox list on the user's NIP-65 write relays.
      const writeRelays = nip65Relays.filter((r) => r.write).map((r) => r.url);
      const { outcome, tags } = await signAndPublish(
        unsigned,
        relayListPublishTargets([...inboxBaseline, ...writeRelays], inboxDraft),
      );
      if (outcome.ok && tags) {
        const published = dmInboxRelaysFromTags(tags);
        // The app must now READ these relays, or DMs sent there are missed.
        await applyPublishedDmInbox(pubkey, published);
        setInboxBaseline(published);
        setInboxDraft(published);
        setInboxDirty(false);
      }
      return outcome;
    } finally {
      setPublishing(null);
    }
  }, [
    pubkey,
    inboxLoading,
    publishing,
    inboxDraft,
    inboxBaseline,
    nip65Relays,
    signAndPublish,
    applyPublishedDmInbox,
  ]);

  return {
    nip65Draft,
    nip65Dirty,
    nip65Loading,
    nip65Editable,
    addNip65,
    removeNip65,
    toggleNip65,
    publishNip65,
    inboxDraft,
    inboxDirty,
    inboxLoading,
    inboxEditable,
    addInbox,
    removeInbox,
    publishInbox,
    publishing,
  };
}
