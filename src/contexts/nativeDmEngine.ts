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

  const batchSub = engine.addListener('onEngineRumorBatch', (event: EngineRumorBatchEvent) => {
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
  const reconnectSub = engine.addListener('onEngineReconnect', () => opts.onReconnect());

  const removeListeners = (): void => {
    batchSub.remove();
    reconnectSub.remove();
  };

  try {
    await engine.engineStart(opts.relays, opts.viewerPubkeyHex, opts.secretKeyHex);
    // Standard NIP-01 filter; rust-nostr's Filter.fromJson parses it as-is.
    // No `since` on wraps — see StartNativeDmEngineOptions.wrapsLimit.
    const filterJson = JSON.stringify({
      kinds: [1059],
      '#p': [opts.viewerPubkeyHex],
      limit: opts.wrapsLimit,
    });
    await engine.engineSubscribeWraps(filterJson, [...opts.knownWrapIds]);
  } catch (e) {
    if (__DEV__) console.warn('[NostrEngine] start failed — falling back to JS wrap sub:', e);
    removeListeners();
    await engine.engineStop().catch(() => {});
    return null;
  }

  let stopped = false;
  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      removeListeners();
      await engine.engineStop().catch(() => {});
    },
  };
}

/**
 * Belt-and-braces global stop for the logout / account-wipe path: the live
 * sub's teardown stops its own engine handle, but a wipe must never race a
 * pool holding the just-wiped account's key — this forces the native stop +
 * key-cache clear regardless of subscription state. Safe no-op when the
 * module is absent or the engine never started.
 */
export async function stopNativeDmEngineGlobal(): Promise<void> {
  const engine = getNostrEngine();
  if (!engine) return;
  await engine.engineStop().catch(() => {});
}
