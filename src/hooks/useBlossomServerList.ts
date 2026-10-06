import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Event } from 'nostr-tools';
import { useNostr } from '../contexts/NostrContext';
import { DEFAULT_RELAYS } from '../services/nostrService';
import { fetchLatestReplaceable, publishToRelays } from '../services/nostrRelayLists';
import {
  DEFAULT_BLOSSOM_SERVER,
  getBlossomServersUnpublished,
  getSavedBlossomServers,
  getSavedLegacyBlossomServer,
  setBlossomServers,
  setBlossomServersUnpublished,
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
  | { ok: false; error: 'not-signed' | 'none-accepted' };

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
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const activePubkeyRef = useRef(pubkey);
  activePubkeyRef.current = pubkey;
  const relayUrls = useMemo(() => relays.map((r) => r.url), [relays]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        setDirty(await getBlossomServersUnpublished());
        const saved = await getSavedBlossomServers();
        if (saved) {
          if (!cancelled) setServers(saved);
          return;
        }
        // A server explicitly chosen before lists existed: keep it.
        const legacy = await getSavedLegacyBlossomServer();
        if (legacy) {
          await setBlossomServers([legacy]);
          if (!cancelled) setServers([legacy]);
          return;
        }
        if (!cancelled) setServers([DEFAULT_BLOSSOM_SERVER]);
        if (!pubkey) return;
        const event = await fetchLatestReplaceable(pubkey, BLOSSOM_SERVER_LIST_KIND, [
          ...new Set([...relayUrls, ...DEFAULT_RELAYS, ...RELAY_LIST_INDEXERS]),
        ]).catch(() => null);
        const published = event ? blossomServersFromTags(event.tags) : [];
        if (cancelled || published.length === 0 || activePubkeyRef.current !== pubkey) return;
        await setBlossomServers(published);
        setServers(published);
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

  const update = useCallback((next: string[]) => {
    setServers(next);
    setDirty(true);
    void setBlossomServers(next);
    void setBlossomServersUnpublished(true);
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
      const signed = await signEvent(buildBlossomServerListEvent(snapshot));
      if (!signed || signed.pubkey !== pk || activePubkeyRef.current !== pk)
        return { ok: false, error: 'not-signed' };
      const targets = [...new Set([...relayUrls, ...DEFAULT_RELAYS, ...RELAY_LIST_INDEXERS])];
      const results = await publishToRelays(signed as unknown as Event, targets);
      const accepted = results.filter((r) => r.ok).length;
      if (accepted === 0) return { ok: false, error: 'none-accepted' };
      // Editing is frozen while publishing, but only clear what was published.
      if (sameList(snapshot, servers)) {
        setDirty(false);
        await setBlossomServersUnpublished(false);
      }
      return { ok: true, accepted, total: results.length };
    } finally {
      setPublishing(false);
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
