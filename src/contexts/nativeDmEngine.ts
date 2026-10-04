import { getNostrEngine, type EngineRumorBatchEvent } from '../../modules/nostr-native';
import type { SignerType } from '../types/nostr';
import type { DecodedRumor } from '../utils/nip17Unwrap';

/**
 * JS adapter for the native relay engine (Stage 2 M2 of #1036).
 *
 * The engine (modules/nostr-native, rust-nostr relay pool) owns the
 * kind-1059 socket + verification + two-layer NIP-59 unwrap and emits
 * batches of plaintext rumors. This adapter is the seam nostrLiveDmSub
 * consumes: it feature-detects the module, starts/stops the pool, parses +
 * shape-validates each batch (mirroring nip17Unwrap's parseRumor checks —
 * native output is trusted-format but never trusted-shape), and surfaces
 * the engine's debounced reconnect signal.
 *
 * Scope guards (all deliberate):
 *  - nsec only — Amber / NIP-46 gift wraps can only be decrypted by their
 *    remote signer, so those accounts stay on the JS path entirely.
 *  - Native platforms only — Android (Kotlin, M2) and iOS (Swift, M3);
 *    getNostrEngine() returns null elsewhere and on pre-M3 iOS binaries.
 *  - Default OFF — EXPO_PUBLIC_NATIVE_ENGINE=1 opts in;
 *    EXPO_PUBLIC_NATIVE_ENGINE_XCHECK=1 (dev-only) runs BOTH paths and
 *    diffs delivered wrap ids (see nativeDmEngineXcheck.ts).
 */

export type NativeEngineMode = 'off' | 'engine' | 'xcheck';

const HEX64 = /^[0-9a-f]{64}$/;

export function getNativeEngineMode(signerType: SignerType | null): NativeEngineMode {
  if (signerType !== 'nsec') return 'off';
  if (!getNostrEngine()) return 'off';
  // Xcheck first: it implies the engine flag and must win when both are set.
  if (__DEV__ && process.env.EXPO_PUBLIC_NATIVE_ENGINE_XCHECK === '1') return 'xcheck';
  if (process.env.EXPO_PUBLIC_NATIVE_ENGINE === '1') return 'engine';
  return 'off';
}

/** One unwrapped gift wrap as delivered by the engine. `rumor` matches the
 * DecodedRumor shape every downstream consumer (group routing, partner
 * derivation, previews) already takes; `wrapId` keys the shared dedupe set
 * and the encrypted store row exactly like the JS path's `wrap.id`. */
export interface EngineDelivery {
  rumor: DecodedRumor;
  senderPubkey: string;
  wrapId: string;
  wrapCreatedAt: number;
}

export interface NativeDmEngineHandle {
  stop(): Promise<void>;
}

export interface StartNativeDmEngineOptions {
  relays: string[];
  viewerPubkeyHex: string;
  /** Viewer secret key, hex — held in the module's single-entry native
   * cache for the engine's lifetime and cleared by engineStop. */
  secretKeyHex: string;
  /** Backlog bound for the wrap filter (mirrors wrapsLimit — #751). The
   * filter deliberately has NO `since`: NIP-59 randomises wrap timestamps
   * up to 48 h back, so a since-cursor silently drops fresh wraps (#469). */
  wrapsLimit: number;
  /** Seeds the engine's native dedupe set (mirror of knownWrapIds). */
  knownWrapIds: Iterable<string>;
  onDeliveries: (deliveries: EngineDelivery[]) => void;
  /** Engine detected a relay reconnect (debounced natively). Caller triggers
   * the existing refreshDmInbox blind-window flush, as #1039 does for the
   * JS sub's re-arm. */
  onReconnect: () => void;
}

/** Validate + normalise one native batch entry. Mirrors parseRumor /
 * bindRumor in nip17Unwrap.ts: reject wrong shapes rather than surfacing
 * junk, and enforce rumor.pubkey === sender (the #830 sender binding — the
 * engine checks it natively too; this is defence in depth at the boundary). */
function parseDelivery(raw: unknown): EngineDelivery | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const sender = typeof entry.sender === 'string' ? entry.sender.toLowerCase() : '';
  const wrapId = typeof entry.wrapId === 'string' ? entry.wrapId.toLowerCase() : '';
  if (!HEX64.test(sender) || !HEX64.test(wrapId)) return null;
  const r = entry.rumor;
  if (!r || typeof r !== 'object') return null;
  const rumor = r as Record<string, unknown>;
  if (typeof rumor.pubkey !== 'string' || !HEX64.test(rumor.pubkey.toLowerCase())) return null;
  if (typeof rumor.created_at !== 'number') return null;
  if (typeof rumor.kind !== 'number') return null;
  if (typeof rumor.content !== 'string') return null;
  if (!Array.isArray(rumor.tags)) return null;
  if (!rumor.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string'))) {
    return null;
  }
  const pubkey = rumor.pubkey.toLowerCase();
  if (pubkey !== sender) return null;
  return {
    rumor: {
      pubkey,
      created_at: rumor.created_at,
      kind: rumor.kind,
      content: rumor.content,
      tags: rumor.tags as string[][],
    },
    senderPubkey: sender,
    wrapId,
    wrapCreatedAt: typeof entry.wrapCreatedAt === 'number' ? entry.wrapCreatedAt : 0,
  };
}

let engineGeneration = 0;

// Every native engine call (start / subscribe / stop) is dispatched only
// after the previous one settles. Native gives no ordering between
// AsyncFunction calls (iOS runs each in its own Task, Android launches each
// on Dispatchers.IO), so without this a logout's engineStop can land BEFORE
// an in-flight engineStart, which then leaves a connected pool + parsed key
// behind with no JS handle left to stop it. With FIFO dispatch a superseded
// start is always followed natively by the stop that superseded it (or by a
// newer start, which replaces it), so its stale branch can return without
// its own engineStop — which would kill the newer session. Relies on start /
// subscribe settling promptly: both platforms' connect() only spawns the
// socket tasks, it never waits for a relay.
let engineQueue: Promise<unknown> = Promise.resolve();

function enqueueEngineCall<T>(call: () => Promise<T>): Promise<T> {
  const result = engineQueue.then(call);
  engineQueue = result.catch(() => {});
  return result;
}

/**
 * Start the native engine for this viewer. Returns null when the module is
 * missing/stale or the native start fails — the caller falls back to the JS
 * wrap subscription. The returned handle's `stop()` tears down the pool AND
 * clears the native key cache (wired into the live sub's teardown, which
 * runs on logout / account switch / relay-list change).
 */
export async function startNativeDmEngine(
  opts: StartNativeDmEngineOptions,
): Promise<NativeDmEngineHandle | null> {
  const engine = getNostrEngine();
  if (!engine) return null;
  const generation = ++engineGeneration;
  const isCurrent = () => generation === engineGeneration;
  let acceptingEvents = false;

  const batchSub = engine.addListener('onEngineRumorBatch', (event: EngineRumorBatchEvent) => {
    if (!isCurrent() || !acceptingEvents) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.rumorsJson);
    } catch (e) {
      if (__DEV__) console.warn('[NostrEngine] unparseable rumor batch:', e);
      return;
    }
    if (!Array.isArray(parsed)) return;
    const deliveries: EngineDelivery[] = [];
    for (const raw of parsed) {
      const delivery = parseDelivery(raw);
      if (delivery) deliveries.push(delivery);
      else if (__DEV__) console.warn('[NostrEngine] dropped malformed batch entry');
    }
    if (deliveries.length > 0) opts.onDeliveries(deliveries);
  });
  const reconnectSub = engine.addListener('onEngineReconnect', () => {
    if (isCurrent() && acceptingEvents) opts.onReconnect();
  });

  const removeListeners = (): void => {
    batchSub.remove();
    reconnectSub.remove();
  };

  // Superseded while queued: never dispatch — a later stop / start already
  // owns the native engine. Superseded while in flight: the superseding call
  // is queued behind this one (see engineQueue), so no cleanup here.
  const dispatchIfCurrent = async (call: () => Promise<unknown>): Promise<boolean> =>
    enqueueEngineCall(async () => {
      if (!isCurrent()) return false;
      await call();
      return true;
    });

  try {
    const started = await dispatchIfCurrent(() =>
      engine.engineStart(opts.relays, opts.viewerPubkeyHex, opts.secretKeyHex),
    );
    if (!started || !isCurrent()) {
      removeListeners();
      return null;
    }
    acceptingEvents = true;
    // Standard NIP-01 filter; rust-nostr's Filter.fromJson parses it as-is.
    // No `since` on wraps — see StartNativeDmEngineOptions.wrapsLimit.
    const filterJson = JSON.stringify({
      kinds: [1059],
      '#p': [opts.viewerPubkeyHex],
      limit: opts.wrapsLimit,
    });
    const subscribed = await dispatchIfCurrent(() =>
      engine.engineSubscribeWraps(filterJson, [...opts.knownWrapIds]),
    );
    if (!subscribed || !isCurrent()) {
      removeListeners();
      return null;
    }
  } catch (e) {
    if (__DEV__) console.warn('[NostrEngine] start failed — falling back to JS wrap sub:', e);
    removeListeners();
    if (isCurrent()) await enqueueEngineCall(() => engine.engineStop()).catch(() => {});
    return null;
  }

  let stopped = false;
  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      removeListeners();
      if (!isCurrent()) return;
      engineGeneration++;
      await enqueueEngineCall(() => engine.engineStop()).catch(() => {});
    },
  };
}

/**
 * Belt-and-braces global stop for the logout / account-wipe path: the live
 * sub's teardown stops its own engine handle, but a wipe must never race a
 * pool holding the just-wiped account's key — this forces the native stop +
 * key-cache clear regardless of subscription state. Queued behind any
 * in-flight start, so it reaches native after that start and tears it down.
 * Safe no-op when the module is absent or the engine never started.
 */
export async function stopNativeDmEngineGlobal(): Promise<void> {
  engineGeneration++;
  const engine = getNostrEngine();
  if (!engine) return;
  await enqueueEngineCall(() => engine.engineStop()).catch(() => {});
}
