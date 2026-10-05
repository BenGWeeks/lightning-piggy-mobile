import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Event } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import { DEFAULT_RELAYS } from '../services/nostrService';
import type { RelayConfig } from '../types/nostr';
import {
  buildDmInboxEvent,
  buildRelayListEvent,
  dmInboxRelaysFromTags,
  mergeRelayRows,
  isPublishableRelayUrl,
  RELAY_LIST_INDEXERS,
  relayListFromTags,
  relayListPublishTargets,
  type UnsignedEvent,
} from '../utils/relayListEvents';
import {
  fetchLatestReplaceable,
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
  const {
    pubkey,
    relays,
    nip65Relays,
    dmInboxRelays,
    signEvent,
    applyPublishedRelayList,
    applyPublishedDmInbox,
  } = useNostr();
  // The identity active NOW — a publish started under another identity must
  // not be adopted (or signed) after the user switches accounts.
  const activePubkeyRef = useRef(pubkey);
  activePubkeyRef.current = pubkey;
  // Latest known inbox list (the provider may finish loading after mount).
  const knownInboxRef = useRef(dmInboxRelays);
  knownInboxRef.current = dmInboxRelays;

  const [nip65Draft, setNip65Draft] = useState<RelayConfig[]>(() => mergeRelayRows(nip65Relays));
  const [nip65Dirty, setNip65Dirty] = useState(false);
  const [nip65Loading, setNip65Loading] = useState(true);
  const [inboxBaseline, setInboxBaseline] = useState<string[]>([]);
  const [inboxDraft, setInboxDraft] = useState<string[]>([]);
  const [inboxDirty, setInboxDirty] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [publishing, setPublishing] = useState<'nip65' | 'inbox' | null>(null);
  // Newest created_at seen per list kind (fetched or published). Each publish
  // must be strictly newer or relays keep the previous event (NIP-01: newest
  // wins, ties by lowest id) — e.g. after another client's clock skew.
  const latestCreatedAtRef = useRef<Record<number, number>>({});
  const nextCreatedAt = (unsigned: UnsignedEvent): UnsignedEvent => ({
    ...unsigned,
    created_at: Math.max(unsigned.created_at, (latestCreatedAtRef.current[unsigned.kind] ?? 0) + 1),
  });

  // Follow the published list until the user starts editing.
  useEffect(() => {
    if (!nip65Dirty) setNip65Draft(mergeRelayRows(nip65Relays));
  }, [nip65Relays, nip65Dirty]);

  const relayUrls = useMemo(() => relays.map((r) => r.url), [relays]);
  useEffect(() => {
    // Per identity: drop any draft from the previous account, so one
    // account's edits can never be signed and published by another.
    setNip65Dirty(false);
    setNip65Draft(mergeRelayRows(nip65Relays));
    setInboxDirty(false);
    setInboxDraft([]);
    setInboxBaseline([]);
    latestCreatedAtRef.current = {};
    if (!pubkey) return;
    let cancelled = false;
    const sources = [...new Set([...relayUrls, ...RELAY_LIST_INDEXERS])];
    setNip65Loading(true);
    setInboxLoading(true);
    void (async () => {
      try {
        const nip65Event = await fetchLatestReplaceable(pubkey, 10002, sources);
        if (cancelled) return;
        if (nip65Event) latestCreatedAtRef.current[10002] = nip65Event.created_at;
        const nip65List = nip65Event ? relayListFromTags(nip65Event.tags) : null;
        if (nip65List) await applyPublishedRelayList(pubkey, nip65List);
        if (cancelled) return;
        setNip65Loading(false);
        // Then the inbox list — also on the (possibly just-discovered) NIP-65
        // write relays, where other clients publish it.
        const writeRelays = (nip65List ?? []).filter((r) => r.write).map((r) => r.url);
        const inboxEvent = await fetchLatestReplaceable(pubkey, 10050, [
          ...new Set([...sources, ...writeRelays]),
        ]);
        if (cancelled) return;
        if (inboxEvent) latestCreatedAtRef.current[10050] = inboxEvent.created_at;
        // A failed lookup isn't "no inbox list": fall back to the known one so
        // publishing extends it rather than silently replacing it.
        const list = inboxEvent ? dmInboxRelaysFromTags(inboxEvent.tags) : knownInboxRef.current;
        // A list found here (wider lookup / newer copy) must also be READ app-wide.
        if (inboxEvent) await applyPublishedDmInbox(pubkey, list, inboxEvent.created_at);
        if (cancelled) return;
        setInboxBaseline(list);
        setInboxDraft(list);
        setInboxLoading(false);
      } catch (e) {
        // A lookup or local adoption failed; editing still proceeds from the
        // known lists rather than leaving the screen stuck.
        console.warn('[RelayListEditor] loading current lists failed:', e);
      } finally {
        // Always finish loading (even if a cache write or lookup threw), so
        // the editor never stays stuck.
        if (!cancelled) {
          setNip65Loading(false);
          setInboxLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Load once per identity; relay-set churn shouldn't reload mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey]);

  // Keep an untouched inbox draft in step with the provider's known list —
  // only when that list CHANGES (not when loading finishes, which would
  // overwrite a just-fetched list with an older provider value).
  const inboxDirtyRef = useRef(inboxDirty);
  inboxDirtyRef.current = inboxDirty;
  const inboxLoadingRef = useRef(inboxLoading);
  inboxLoadingRef.current = inboxLoading;
  useEffect(() => {
    if (inboxDirtyRef.current || inboxLoadingRef.current) return;
    setInboxDraft(dmInboxRelays);
    setInboxBaseline(dmInboxRelays);
  }, [dmInboxRelays]);

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
    async (unsigned: UnsignedEvent, targets: string[], pk: string) => {
      const signed = await signEvent(nextCreatedAt(unsigned));
      // Must be signed by the identity that started this publish, which must
      // still be the active one (no cross-account publish after a switch).
      if (!signed || signed.pubkey !== pk || activePubkeyRef.current !== pk)
        return { outcome: { ok: false as const, error: 'not-signed' as const } };
      latestCreatedAtRef.current[signed.kind] = Math.max(
        latestCreatedAtRef.current[signed.kind] ?? 0,
        signed.created_at,
      );
      const results = await publishToRelays(signed as unknown as Event, targets);
      const outcome: RelayListPublishOutcome = results.some((r) => r.ok)
        ? { ok: true, results }
        : { ok: false, error: 'none-accepted', results };
      return { outcome, tags: signed.tags, createdAt: signed.created_at };
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
        // Also the relays the app (and other clients) discover lists on, so
        // any old copy there is replaced rather than later restored.
        relayListPublishTargets(
          [...nip65Relays.map((r) => r.url), ...relayUrls, ...DEFAULT_RELAYS],
          nip65Draft.map((r) => r.url),
        ),
        pubkey,
      );
      if (outcome.ok && tags && activePubkeyRef.current === pubkey) {
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
    relayUrls,
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
      const {
        outcome,
        tags,
        createdAt: signedAt,
      } = await signAndPublish(
        unsigned,
        relayListPublishTargets(
          [...inboxBaseline, ...writeRelays, ...relayUrls, ...DEFAULT_RELAYS],
          inboxDraft,
        ),
        pubkey,
      );
      if (outcome.ok && tags && activePubkeyRef.current === pubkey) {
        const published = dmInboxRelaysFromTags(tags);
        // The app must now READ these relays, or DMs sent there are missed.
        await applyPublishedDmInbox(pubkey, published, signedAt);
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
    relayUrls,
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
