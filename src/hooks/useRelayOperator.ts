import { useEffect, useState } from 'react';
import { useNostr } from '../contexts/NostrContext';
import * as profileCache from '../services/zapSenderProfileStorage';
import type { NostrProfile } from '../types/nostr';

/** One operator through the existing bounded kind-0 batch/cache, never `self`. */
export function useRelayOperator(pubkey?: string) {
  const { fetchProfilesForPubkeys } = useNostr();
  const [profile, setProfile] = useState<NostrProfile | null>(null);
  const [verifiedNip05, setVerifiedNip05] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setProfile(null);
    setVerifiedNip05(null);
    if (pubkey)
      void (async () => {
        const cached = await profileCache.get(pubkey);
        if (!active) return;
        const next: NostrProfile | null = cached
          ? {
              pubkey,
              npub: cached.npub ?? '',
              name: cached.name ?? null,
              displayName: cached.displayName ?? null,
              picture: cached.picture ?? null,
              nip05: cached.nip05 ?? null,
              banner: null,
              about: null,
              lud16: null,
            }
          : ((await fetchProfilesForPubkeys([pubkey])).get(pubkey) ?? null);
        if (!active) return;
        setProfile(next);
        if (next && !cached)
          void profileCache
            .setMany(
              new Map([
                [
                  pubkey,
                  {
                    npub: next.npub,
                    name: next.name,
                    displayName: next.displayName,
                    picture: next.picture,
                    nip05: next.nip05,
                  },
                ],
              ]),
            )
            .catch(() => {});
        const identifier = next?.nip05;
        if (!identifier) return;
        const match = /^([^\s@]+)@([a-z0-9.-]+)$/i.exec(identifier);
        if (!match) return;
        timer = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(
            `https://${match[2]}/.well-known/nostr.json?name=${encodeURIComponent(match[1])}`,
            { signal: controller.signal },
          );
          if (!response.ok) return;
          const value = await response.json();
          if (active && value?.names?.[match[1]]?.toLowerCase() === pubkey)
            setVerifiedNip05(identifier);
        } catch {
          /* optional identity verification */
        } finally {
          clearTimeout(timer);
        }
      })().catch(() => {});
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [pubkey, fetchProfilesForPubkeys]);
  return { profile, verifiedNip05 };
}
