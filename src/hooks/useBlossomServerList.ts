import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Event } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import { DEFAULT_RELAYS } from '../services/nostrService';
import { fetchLatestReplaceable, publishToRelays } from '../services/nostrRelayLists';
import {
  DEFAULT_BLOSSOM_SERVER,
  getPublishedBlossomServers,
  getSavedBlossomServers,
  getSavedLegacyBlossomServer,
  setBlossomServers,
  setPublishedBlossomServers,
} from '../services/walletStorageService';
import { RELAY_LIST_INDEXERS } from '../utils/relayListEvents';
import {
  BLOSSOM_SERVER_LIST_KIND,
  blossomServersFromTags,
  buildBlossomServerListEvent,
  normalizeBlossomServer,
} from '../utils/blossomServerList';

export type BlossomPublishOutcome =
  | { ok: true; accepted: number; total: number }
  | { ok: false; error: 'not-signed' | 'none-accepted' | 'no-valid-servers' };

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((s, i) => s === b[i]);

/**
 * The user's Blossom servers (#1149): primary first, the rest backups that
 * uploads are mirrored to. Edits are saved on the device straight away (they
 * apply to the next upload); Publish shares the list as a BUD-03 kind-10063
 * event so other Nostr apps use the same servers.
 *
 * On load: a saved list wins; else a server the user explicitly set before
 * lists existed becomes the list; only a device on the default adopts a
 * published list. Editing is frozen while loading and while publishing, so
 * neither a late lookup nor a publish result can override a newer edit.
 */
export function useBlossomServerList() {
  const { pubkey, relays, signEvent } = useNostr();
  const [servers, setServers] = useState<string[]>([]);
  // The list last published (null = never): Publish is offered whenever the
  // current list differs, including a list that was never published.
  const [publishedList, setPublishedList] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const activePubkeyRef = useRef(pubkey);
  activePubkeyRef.current = pubkey;
  // Newest kind-10063 created_at seen (fetched or published): each publish is
  // signed strictly after it, or relays keep the old list (NIP-01).
  const latestCreatedAtRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  const relayUrls = useMemo(() => relays.map((r) => r.url), [relays]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const publishedBaseline = pubkey ? await getPublishedBlossomServers(pubkey) : null;
        if (!cancelled) setPublishedList(publishedBaseline);
        const saved = await getSavedBlossomServers();
        if (saved) {
          if (!cancelled) setServers(saved);
          return;
        }
        // A server explicitly chosen before lists existed: keep it.
        // (The old field also saved an unchanged default — not a real choice.)
        const legacy = await getSavedLegacyBlossomServer();
        if (legacy && legacy !== DEFAULT_BLOSSOM_SERVER) {
          await setBlossomServers([legacy]);
          if (!cancelled) setServers([legacy]);
          return;
        }
        if (!cancelled) setServers([DEFAULT_BLOSSOM_SERVER]);
        if (!pubkey) return;
        const event = await fetchLatestReplaceable(pubkey, BLOSSOM_SERVER_LIST_KIND, [
          ...new Set([...relayUrls, ...DEFAULT_RELAYS, ...RELAY_LIST_INDEXERS]),
        ]).catch(() => null);
        if (event)
          latestCreatedAtRef.current = Math.max(latestCreatedAtRef.current, event.created_at);
        const published = event ? blossomServersFromTags(event.tags) : [];
        if (cancelled || published.length === 0 || activePubkeyRef.current !== pubkey) return;
        await setBlossomServers(published);
        await setPublishedBlossomServers(pubkey, published);
        setServers(published);
        setPublishedList(published);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Load once per identity; relay churn shouldn't reload mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey]);

  const editable = !loading && !publishing;
  const dirty = publishedList === null || !sameList(servers, publishedList);

  const update = useCallback((next: string[]) => {
    setServers(next);
    void setBlossomServers(next);
  }, []);

  /** Add a server as a backup; false if the URL isn't a valid https server. */
  const addServer = useCallback(
    (input: string): boolean => {
      const url = normalizeBlossomServer(input);
      if (!url) return false;
      if (editable && !servers.includes(url)) update([...servers, url]);
      return true;
    },
    [editable, servers, update],
  );

  // The last server can't be removed — uploads always need one.
  const removeServer = useCallback(
    (url: string) => {
      if (editable && servers.length > 1) update(servers.filter((s) => s !== url));
    },
    [editable, servers, update],
  );

  const makePrimary = useCallback(
    (url: string) => {
      if (editable) update([url, ...servers.filter((s) => s !== url)]);
    },
    [editable, servers, update],
  );

  const publish = useCallback(async (): Promise<BlossomPublishOutcome> => {
    const pk = pubkey;
    if (!pk) return { ok: false, error: 'not-signed' };
    const snapshot = servers;
    setPublishing(true);
    try {
      // The newest list on the relays (another client, or a future-dated one).
      const current = await fetchLatestReplaceable(pk, BLOSSOM_SERVER_LIST_KIND, [
        ...new Set([...relayUrls, ...DEFAULT_RELAYS, ...RELAY_LIST_INDEXERS]),
      ]).catch(() => null);
      if (current)
        latestCreatedAtRef.current = Math.max(latestCreatedAtRef.current, current.created_at);
      const unsigned = buildBlossomServerListEvent(snapshot);
      // Never publish an empty list (e.g. only a legacy http:// server), which
      // would replace an existing one with nothing.
      if (unsigned.tags.length === 0) return { ok: false, error: 'no-valid-servers' };
      unsigned.created_at = Math.max(unsigned.created_at, latestCreatedAtRef.current + 1);
      const signed = await signEvent(unsigned);
      if (!signed || signed.pubkey !== pk || activePubkeyRef.current !== pk)
        return { ok: false, error: 'not-signed' };
      const targets = [...new Set([...relayUrls, ...DEFAULT_RELAYS, ...RELAY_LIST_INDEXERS])];
      const results = await publishToRelays(signed as unknown as Event, targets);
      const accepted = results.filter((r) => r.ok).length;
      if (accepted === 0) return { ok: false, error: 'none-accepted' };
      latestCreatedAtRef.current = Math.max(latestCreatedAtRef.current, unsigned.created_at);
      // Record exactly what was published; a list edited meanwhile (here or in
      // another screen instance) still differs from it, so stays publishable.
      // What was actually signed (invalid entries are dropped from the event).
      const sent = blossomServersFromTags(signed.tags);
      await setPublishedBlossomServers(pk, sent);
      if (mountedRef.current) setPublishedList(sent);
      return { ok: true, accepted, total: results.length };
    } finally {
      if (mountedRef.current) setPublishing(false);
    }
  }, [pubkey, servers, signEvent, relayUrls]);

  return {
    servers,
    dirty,
    loading,
    publishing,
    editable,
    addServer,
    removeServer,
    makePrimary,
    publish,
  };
}
