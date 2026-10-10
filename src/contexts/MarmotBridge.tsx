import { useEffect, useRef } from 'react';

import { startMarmotPushRegistration } from '../services/marmotPushRegistration';
import { MarmotSession, setMarmotSession } from '../services/marmotSession';
import { DEFAULT_RELAYS } from '../services/nostrService';
import { RELAY_LIST_INDEXERS } from '../utils/relayListEvents';
import { useNostr } from './NostrContext';

// Defer the MLS bring-up past cold start: loading group state + opening one
// relay sub per group is real JS-thread work, and nothing on first paint
// needs it (#perf: stagger non-latency-sensitive startup work).
const START_DELAY_MS = 3_000;

/**
 * Owns the Marmot (MLS) session lifecycle: one session per signed-in
 * account, started after cold start, torn down on sign-out / account
 * switch / signer change. Renders nothing. Relays are read through refs so
 * a relay-list edit doesn't tear down live MLS state.
 */
export function MarmotBridge(): null {
  const { isLoggedIn, pubkey, signerType, relays } = useNostr();
  const relaysRef = useRef(relays);
  relaysRef.current = relays;

  // Opt-in Marmot push (MIP-05): one device token, opted into per account —
  // each session only carries it if its own account turned push on.
  // Staggered like the session itself — nothing on first paint needs it.
  useEffect(() => {
    let stop: (() => void) | null = null;
    const timer = setTimeout(() => (stop = startMarmotPushRegistration()), START_DELAY_MS);
    return () => {
      clearTimeout(timer);
      stop?.();
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !pubkey || !signerType) return;
    const unique = (urls: string[]) => [...new Set(urls)];
    const writeRelays = () => {
      const own = relaysRef.current.filter((r) => r.write).map((r) => r.url);
      return own.length > 0 ? own : DEFAULT_RELAYS;
    };
    const lookupRelays = () =>
      unique([
        ...relaysRef.current.filter((r) => r.read).map((r) => r.url),
        ...RELAY_LIST_INDEXERS,
        ...DEFAULT_RELAYS,
      ]);

    let session: MarmotSession | null = null;
    const timer = setTimeout(() => {
      session = new MarmotSession({
        pubkey,
        signerType,
        getWriteRelays: writeRelays,
        getLookupRelays: lookupRelays,
      });
      setMarmotSession(session);
      session.start().catch((e) => {
        if (__DEV__) console.warn('[Marmot] session start failed:', e);
      });
    }, START_DELAY_MS);

    return () => {
      clearTimeout(timer);
      if (session) setMarmotSession(null);
    };
  }, [isLoggedIn, pubkey, signerType]);

  return null;
}
