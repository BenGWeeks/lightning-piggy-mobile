import { bytesToHex } from '@noble/hashes/utils.js';
import type { DecodedRumor } from '../utils/nip17Unwrap';
import { getMemoisedSecretKey } from './nostrSecretKeyCache';
import { yieldToEventLoop } from './nostrDecryptPacing';
import { capKnownWrapIds } from './knownWrapIdsCap';
import {
  getNativeEngineMode,
  startNativeDmEngine,
  type EngineDelivery,
  type NativeDmEngineHandle,
  type NativeEngineMode,
} from './nativeDmEngine';
import { createEngineXcheck, type EngineXcheck } from './nativeDmEngineXcheck';
import type { SignerType } from '../types/nostr';
import type { RefreshDmInboxOptions } from './nostrContextTypes';

/**
 * The live DM sub's side of the native relay engine (Stage 2 M2, #1036):
 * start/stop lifecycle, delivery pacing into the shared rumor-surface path,
 * the dev cross-check differ, and the reconnect → refreshDmInbox flush.
 * Extracted from nostrLiveDmSub.ts so the (already large) subscription file
 * doesn't grow — the sub keeps only mode selection and the skipWraps wiring.
 */

// How long after the engine's reconnect signal we wait before firing
// refreshDmInbox — gives the re-subscribed relay time to push its first
// backlog burst so the refresh doesn't race it. Matches #1039's settle.
const ENGINE_RECONNECT_REFRESH_SETTLE_MS = 1_500;
// Pacing for engine-delivered rumor batches: the per-rumor JS work is small
// (no decrypt — that happened natively), so yield every N rumors instead of
// the JS path's per-wrap yield (#496).
const ENGINE_BATCH_YIELD_EVERY = 10;

export interface LiveDmEngineBridgeDeps {
  activeSigner: SignerType;
  viewerPubkey: string;
  readRelays: string[];
  /** Backlog bound for the engine's wrap filter (COLD_INITIAL_WRAP_LIMIT). */
  wrapsLimit: number;
  /** The live sub's shared dedupe Set — the bridge claims ids into it and
   * seeds the engine's native mirror from it at subscribe time. */
  knownWrapIds: Set<string>;
  isCancelled: () => boolean;
  /** Shared post-unwrap policy (liveDmRumorSurface.ts). */
  surfaceRumor: (rumor: DecodedRumor, wrapId: string) => Promise<void>;
  /** The #1039-style blind-window flush (refreshDmInbox via stable ref). */
  onReconnect?: (opts?: RefreshDmInboxOptions) => Promise<void>;
  /** Native start failed / no key: the sub must re-arm its JS wrap filter
   * so the inbox never goes deaf behind the flag. */
  onEngineUnavailable: () => void;
}

export interface LiveDmEngineBridge {
  mode: NativeEngineMode;
  /** Record a JS-path unwrap for the dev cross-check differ (no-op outside
   * xcheck mode). */
  recordJsUnwrap: (wrapId: string) => void;
  /** Start the pool (no-op in 'off' mode). Call AFTER knownWrapIds is
   * seeded so the engine's native dedupe mirror gets the same ids. */
  start: () => Promise<void>;
  stop: () => void;
}

export function createLiveDmEngineBridge(deps: LiveDmEngineBridgeDeps): LiveDmEngineBridge {
  const mode = getNativeEngineMode(deps.activeSigner);
  const xcheck: EngineXcheck | null = mode === 'xcheck' ? createEngineXcheck() : null;
  let handle: NativeDmEngineHandle | null = null;

  // Rumors delivered by the native engine (already verified + unwrapped +
  // sender-bound natively). The JS-side knownWrapIds claim stays
  // authoritative — the engine's own dedupe set is seeded once at subscribe
  // time, so ids learned later by refreshDmInbox only exist here.
  const handleDeliveries = async (deliveries: EngineDelivery[]): Promise<void> => {
    let sinceYield = 0;
    for (const delivery of deliveries) {
      if (deps.isCancelled()) return;
      if (xcheck) {
        // Observe-only in xcheck mode: the JS path keeps surfacing.
        xcheck.recordEngine(delivery.wrapId);
        continue;
      }
      if (deps.knownWrapIds.has(delivery.wrapId)) continue;
      deps.knownWrapIds.add(delivery.wrapId);
      capKnownWrapIds(deps.knownWrapIds);
      if (__DEV__)
        console.log(
          `[Nostr] engine rumor recv ${delivery.wrapId.slice(0, 8)} kind=${delivery.rumor.kind}`,
        );
      await deps.surfaceRumor(delivery.rumor, delivery.wrapId);
      // Batch pacing: keep a big backlog batch from monopolising the JS thread.
      if (++sinceYield >= ENGINE_BATCH_YIELD_EVERY) {
        sinceYield = 0;
        await yieldToEventLoop();
        if (deps.isCancelled()) return;
      }
    }
  };

  // Engine relay reconnect → refreshDmInbox blind-window flush, mirroring
  // #1039's re-arm semantics: wraps sent while a socket was down can rank
  // below the wrap filter's `limit` (#469 random timestamps), so the pool
  // re-subscribing on reconnect doesn't guarantee they re-stream. The
  // settle delay gives the relay time to push its first burst.
  const onEngineReconnect = (): void => {
    const { onReconnect } = deps;
    if (deps.isCancelled() || !onReconnect || xcheck) return;
    setTimeout(() => {
      if (deps.isCancelled()) return;
      if (__DEV__)
        console.log('[Nostr] engine reconnect — triggering refreshDmInbox to close blind window');
      onReconnect({ force: true }).catch((e) => {
        if (__DEV__) console.warn('[Nostr] engine reconnect refresh failed:', e);
      });
    }, ENGINE_RECONNECT_REFRESH_SETTLE_MS);
  };

  const start = async (): Promise<void> => {
    if (mode === 'off' || deps.isCancelled()) return;
    const secretKey = await getMemoisedSecretKey(deps.viewerPubkey);
    const started =
      secretKey && !deps.isCancelled()
        ? await startNativeDmEngine({
            relays: deps.readRelays,
            viewerPubkeyHex: deps.viewerPubkey,
            secretKeyHex: bytesToHex(secretKey),
            wrapsLimit: deps.wrapsLimit,
            knownWrapIds: deps.knownWrapIds,
            onDeliveries: (deliveries) => {
              handleDeliveries(deliveries).catch((e) => {
                if (__DEV__) console.warn('[Nostr] engine delivery handler failed:', e);
              });
            },
            onReconnect: onEngineReconnect,
          })
        : null;
    if (deps.isCancelled()) {
      void started?.stop();
      return;
    }
    handle = started;
    if (!started && mode === 'engine') {
      if (__DEV__) console.warn('[Nostr] engine unavailable — re-arming JS wrap sub');
      deps.onEngineUnavailable();
    } else if (started && __DEV__) {
      console.log(
        `[Nostr] engine started (${mode}) for ${deps.viewerPubkey.slice(0, 8)} on ${deps.readRelays.length} relays`,
      );
    }
  };

  return {
    mode,
    recordJsUnwrap: (wrapId) => xcheck?.recordJs(wrapId),
    start,
    stop: () => {
      // Stops the rust-nostr pool AND clears the module's single-entry key
      // cache (Stage 2 M2 key lifecycle) — fire-and-forget, idempotent; the
      // logout path's stopNativeDmEngineGlobal covers a racing slow stop.
      void handle?.stop();
      handle = null;
      xcheck?.dispose();
    },
  };
}
