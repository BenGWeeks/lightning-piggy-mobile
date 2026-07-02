/**
 * backgroundDmService — Amethyst-style realtime background DM notifications
 * for Android (#279 realtime upgrade).
 *
 * THE GAP THIS CLOSES. The app already surfaces real-content DM notifications
 * the moment a wrap arrives — but ONLY while the React tree is mounted, via
 * the live sub in `src/contexts/nostrLiveDmSub.ts`. Once the app is
 * backgrounded, Doze / App-Standby suspends the JS engine and the relay
 * WebSocket within minutes, so new messages aren't noticed until the user
 * reopens the app (or the ~15-min `expo-background-task` detect-and-ping in
 * `backgroundSyncService.ts` happens to wake — which only fires a GENERIC
 * "you have new messages" ping, never the content).
 *
 * This module is the control + worker layer for a persistent Android
 * FOREGROUND SERVICE that keeps that live subscription alive in the
 * background, exactly like Amethyst — no FCM, no Google Play Services, no
 * remote push server, so it works on GrapheneOS / microG. A foreground
 * service is the only Doze-immune path that doesn't require GMS.
 *
 * SIGNER-AWARE PRIVACY (Signal sealed-sender style).
 *   - nsec (local key): we can decrypt off-screen, so the notification
 *     carries the sender name + a message preview (subject to the user's
 *     lock-screen-content preference, enforced in notificationService).
 *   - Amber / NIP-46 remote: the secret key is NOT on the device, and a
 *     remote signer can't approve a decrypt headlessly — so we post a
 *     CONTENTLESS "New encrypted message" notification. The detail loads
 *     when the user opens the app and the signer is reachable.
 *
 * iOS is OUT OF SCOPE: iOS can't hold a background socket; realtime DM
 * notifications there need APNs + a remote server, which the project
 * explicitly rejects. Every entry point here is guarded on
 * `Platform.OS === 'android'` and no-ops elsewhere.
 *
 * ───────────────────────────────────────────────────────────────────────
 * NATIVE GLUE (the piece that makes this a true background watch).
 * ───────────────────────────────────────────────────────────────────────
 * Keeping the JS engine + WebSocket alive while the app is backgrounded needs
 * a native foreground `Service`. That lives in the local Expo module
 * `modules/background-dm-service`: `BackgroundDmService` (a
 * HeadlessJsTaskService) hosts the `BackgroundDmTask` headless JS task — see
 * `src/services/backgroundDmHeadlessTask.ts` — which calls
 * `runBackgroundDmWatch()` in a headless context, so the subscription survives
 * the app being backgrounded or swiped away. `BackgroundDmModule` is the
 * start/stop bridge this file calls; `BootReceiver` re-arms after a reboot.
 * Permissions are declared in `plugins/withForegroundService.js`; the
 * `<service>`/`<receiver>` in the module's own manifest.
 *
 * When that native module ISN'T present in the build (Expo Go, or a dev client
 * predating the native rebuild), this layer degrades gracefully: it persists
 * the preference, posts/dismisses the chip, and runs the subscription inline
 * for as long as the foreground JS context is alive — already an upgrade over
 * the ~15-min detect-and-ping, just not Doze-immune.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadIdentities, type StoredIdentity } from './identitiesStore';
import { getUserRelays, mergeRelays } from './nostrRelayStorage';
import { perAccountKey } from './perAccountStorage';
import { RELAY_LIST_CACHE_KEY_BASE } from '../contexts/nostrCacheKeys';
import { claimWrapNotification } from './dmWrapNotificationDedupe';
import type { RelayConfig } from '../types/nostr';
import * as nostrService from './nostrService';
import { subscribeInboxDmsForViewer } from './dmLiveSubscription';
import {
  fireMessageNotification,
  hasNotificationPermission,
  showForegroundServiceNotification,
  dismissForegroundServiceNotification,
} from './notificationService';
import * as zapSenderProfileStorage from './zapSenderProfileStorage';
import {
  unwrapWrapNsec,
  partnerFromRumor,
  textForRumor,
  type DecodedRumor,
} from '../utils/nip17Unwrap';
import { loadBackgroundDmEnabled } from './backgroundDmPreference';
import {
  startForegroundService,
  stopForegroundService,
  isBackgroundDmServiceAvailable,
} from '../../modules/background-dm-service';

// NIP-59 randomises a gift wrap's `created_at` up to ~2 days into the PAST,
// so a genuinely-new wrap can arrive with an already-old timestamp. We only
// notify for wraps whose INNER rumor timestamp is at/after the sub-open time
// (minus skew) — the inner kind-14 `created_at` is the real send time, the
// outer wrap time is not. Mirrors `isFreshArrival` in nostrLiveDmSub.ts so
// the relay's on-open backlog replay doesn't flood notifications.
const NOTIFY_SKEW_SEC = 120;

// Bound the kind-1059 backlog the relay re-streams when the sub opens, so
// arming the watch doesn't re-ingest the full wrap history. New wraps still
// arrive live after EOSE. Matches the spirit of COLD_INITIAL_WRAP_LIMIT used
// by the foreground live sub.
const BACKLOG_WRAPS_LIMIT = 50;

// Remote-signer (contentless) watches can't decrypt, so the rumor-timestamp
// freshness gate can't run — every replayed wrap would otherwise become a
// generic notification burst on arm (Copilot review, PR #958). Those wraps
// are gated on EOSE below; this smaller limit additionally bounds any
// stragglers a slow relay replays after the first relay's EOSE.
const CONTENTLESS_BACKLOG_WRAPS_LIMIT = 10;

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Resolve the viewer's read relays the same way the app's foreground context
 * does: defaults + cached NIP-65 list + user overrides, merged with the same
 * precedence (`mergeRelays`). `getUserRelays()` alone is ONLY the user's
 * explicit in-app overrides — `[]` for anyone who never customised relays —
 * which is why the watch must never use it bare: it silently armed nothing
 * for default-relay users (the original #279 swipe-away bug). `mergeRelays`
 * always folds in DEFAULT_RELAYS, so this can't return an empty read set.
 */
async function resolveReadRelays(pubkey: string): Promise<string[]> {
  let nip65: RelayConfig[] = [];
  try {
    const raw = await AsyncStorage.getItem(perAccountKey(RELAY_LIST_CACHE_KEY_BASE, pubkey));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      nip65 = parsed.filter(
        (r): r is RelayConfig =>
          r &&
          typeof r === 'object' &&
          typeof r.url === 'string' &&
          typeof r.read === 'boolean' &&
          typeof r.write === 'boolean',
      );
    }
  } catch {
    // Unreadable cache just means defaults + user overrides.
  }
  const user = await getUserRelays().catch(() => []);
  return mergeRelays({ nip65, user })
    .filter((r) => r.read)
    .map((r) => r.url);
}

interface ActiveWatch {
  viewerPubkey: string;
  unsubscribe: () => void;
}

let activeWatch: ActiveWatch | null = null;

/**
 * Resolve a sender's display name from the persisted profile cache, falling
 * back to a relay fetch, then to a shortened npub-ish hex. Best-effort and
 * never throws — a missing name just yields a generic label.
 */
async function resolveSenderName(pubkey: string, readRelays: string[]): Promise<string> {
  const short = `${pubkey.slice(0, 8)}…`;
  try {
    const cached =
      zapSenderProfileStorage.peekSync(pubkey) ?? (await zapSenderProfileStorage.get(pubkey));
    const cachedName = cached?.displayName || cached?.name;
    if (cachedName) return cachedName;
  } catch {
    // fall through to relay fetch
  }
  try {
    const profile = await nostrService.fetchProfile(pubkey, readRelays);
    const name = profile?.displayName || profile?.name;
    if (name) return name;
  } catch {
    // fall through to the short hex
  }
  return short;
}

/**
 * The decrypt + notify side-effect for one inbound wrap, signer-aware.
 *
 * `decryptWrap` is null for remote signers (Amber / NIP-46), in which case we
 * skip decryption entirely and post a contentless "New encrypted message"
 * (Signal sealed-sender style) — we still know a wrap addressed to us
 * arrived, we just can't read it off-screen.
 */
async function handleWrap(input: {
  ev: nostrService.RawInboxDmEvent;
  viewerPubkey: string;
  readRelays: string[];
  subOpenedAtSec: number;
  decryptWrap: ((wrap: nostrService.RawGiftWrapEvent) => DecodedRumor | null) | null;
  /** True once the subscription's initial backlog replay has settled (EOSE). */
  backlogSettled: () => boolean;
}): Promise<void> {
  const { ev, viewerPubkey, readRelays, subOpenedAtSec, decryptWrap } = input;
  // This background watch only cares about NIP-17 gift wraps (kind 1059) —
  // the modern DM format. Legacy kind-4 and marketplace kind-16/17 are left
  // to the foreground live sub; mirroring all of them here would duplicate a
  // lot of nostrLiveDmSub for diminishing returns.
  if (ev.kind !== 1059) return;

  // Contentless path: remote signer can't decrypt headlessly. We can't tell
  // who it's from (that's inside the wrap), so the notification is fully
  // generic and the thread id is a sentinel that never matches an actively-
  // viewed thread. Because we can't read the inner rumor timestamp, the
  // freshness gate below can't run — instead stay SILENT until the initial
  // backlog replay settles (EOSE), so arming doesn't burst a generic
  // notification per replayed wrap. The claim keeps the foreground live sub
  // (which can be armed in the same JS context and receive this same wrap)
  // from posting a second notification — see dmWrapNotificationDedupe.
  if (!decryptWrap) {
    if (!input.backlogSettled()) return;
    if (!claimWrapNotification(ev.id)) return;
    await fireMessageNotification({
      kind: 'dm',
      threadId: '__background__',
      title: 'New encrypted message',
      body: 'Open Lightning Piggy to read',
      data: {},
    });
    return;
  }

  const rumor = decryptWrap(ev);
  if (!rumor) {
    console.warn('[BgDmWatch] wrap skipped: decrypt failed');
    return;
  }
  // Only notify for genuinely-fresh arrivals (the inner rumor timestamp is
  // the real send time; the relay's on-open backlog has old timestamps).
  if (rumor.created_at < subOpenedAtSec - NOTIFY_SKEW_SEC) return;

  const partnership = partnerFromRumor(rumor, viewerPubkey);
  if (!partnership) return;
  // Never notify for our own echoes (self-wraps / outgoing copies).
  if (partnership.fromMe) return;
  // Claim BEFORE the async name resolution below — the claim is the
  // synchronous point that closes the race with the foreground live sub
  // processing the same wrap on the same JS thread.
  if (!claimWrapNotification(ev.id)) return;
  console.warn('[BgDmWatch] fresh wrap → firing notification');

  const senderName = await resolveSenderName(partnership.partnerPubkey, readRelays);
  // textForRumor folds kind-15 file messages into a renderable URL; for a
  // notification body we want the human-facing text. The notificationService
  // redacts to generic copy when the user has lock-screen content disabled,
  // so passing the plaintext here is safe.
  const preview = textForRumor(rumor);
  const notifId = await fireMessageNotification({
    kind: 'dm',
    threadId: partnership.partnerPubkey,
    title: senderName,
    body: preview,
    data: { conversationPubkey: partnership.partnerPubkey },
  });
  console.warn(`[BgDmWatch] notification result: ${notifId ?? 'suppressed/failed'}`);
}

/**
 * Build the per-wrap decryptor for the active identity, or null when the
 * secret key isn't locally available (Amber / NIP-46 remote → contentless
 * notifications). Pure-JS NIP-44 via nostr-tools for the nsec path; no
 * dependency on the React context layer so this is safe to run headless.
 */
function buildDecryptor(
  identity: StoredIdentity,
): ((wrap: nostrService.RawGiftWrapEvent) => DecodedRumor | null) | null {
  if (identity.signerType !== 'nsec' || !identity.nsec) return null;
  let secretKey: Uint8Array;
  try {
    const decoded = nostrService.decodeNsec(identity.nsec);
    if (decoded.pubkey !== identity.pubkey) return null;
    secretKey = decoded.secretKey;
  } catch {
    return null;
  }
  // Reuse the exact same two-layer NIP-17 unwrap the foreground path uses, so
  // the sender-binding / validation rules can't drift between paths.
  return (wrap) => unwrapWrapNsec(wrap, secretKey);
}

/**
 * Run one background DM watch session: open the live kind-1059 subscription
 * for the active identity and fire signer-aware notifications on new wraps.
 * Idempotent — re-arming tears down any prior watch first. Returns true if a
 * watch was armed, false when there's nothing to watch (no identity, no read
 * relays, or not Android).
 *
 * This is the function the native foreground-service headless task
 * (`BackgroundDmTask`, see backgroundDmHeadlessTask.ts) calls to arm the
 * watch in its headless context. When the native module is absent it's driven
 * directly by `startBackgroundDmWatch` instead, so the experience still works
 * for as long as the foreground JS context is alive.
 */
export async function runBackgroundDmWatch(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  // Tear down any existing watch so we never stack two subscriptions.
  stopBackgroundDmWatchSubscription();

  const { identities, activePubkey } = await loadIdentities();
  if (!activePubkey || !HEX64.test(activePubkey)) {
    console.warn('[BgDmWatch] not armed: no active pubkey');
    return false;
  }
  const identity = identities.find((i) => i.pubkey === activePubkey);
  if (!identity) {
    console.warn('[BgDmWatch] not armed: active identity not found');
    return false;
  }

  const readRelays = await resolveReadRelays(activePubkey);
  if (readRelays.length === 0) {
    console.warn('[BgDmWatch] not armed: no read relays');
    return false;
  }

  const decryptWrap = buildDecryptor(identity);
  const subOpenedAtSec = Math.floor(Date.now() / 1000);
  console.warn(
    `[BgDmWatch] arming: relays=${readRelays.length} decryptor=${decryptWrap ? 'nsec' : 'contentless'}`,
  );

  // Backlog-settled latch for the contentless path (see handleWrap). The nsec
  // path doesn't need it — its per-wrap rumor-timestamp gate is stricter.
  let eosed = false;
  const unsubscribe = subscribeInboxDmsForViewer({
    viewerPubkey: activePubkey,
    relays: readRelays,
    wrapsLimit: decryptWrap ? BACKLOG_WRAPS_LIMIT : CONTENTLESS_BACKLOG_WRAPS_LIMIT,
    onEose: () => {
      eosed = true;
    },
    onEvent: (ev) => {
      // Fire-and-forget per event; swallow per-event errors so one bad wrap
      // can't tear down the long-lived subscription.
      void handleWrap({
        ev,
        viewerPubkey: activePubkey,
        readRelays,
        subOpenedAtSec,
        decryptWrap,
        backlogSettled: () => eosed,
      }).catch((e) => {
        console.warn('[backgroundDmService] handleWrap failed:', e);
      });
    },
  });

  activeWatch = { viewerPubkey: activePubkey, unsubscribe };
  return true;
}

/** Close the live subscription without touching the foreground chip. */
function stopBackgroundDmWatchSubscription(): void {
  if (activeWatch) {
    try {
      activeWatch.unsubscribe();
    } catch {
      // best-effort
    }
    activeWatch = null;
  }
}

/**
 * Enable the background DM watch: post the persistent foreground status chip
 * and arm the live subscription. Android-only; no-ops elsewhere. Call after
 * the user flips the Settings toggle ON (and notification permission is
 * granted). Does NOT persist the preference — the toggle handler owns that
 * via `setBackgroundDmEnabled`.
 *
 * Starts the native foreground service (modules/background-dm-service) when
 * it's present in the build, so the JS context — and this subscription —
 * survives the app being backgrounded or swiped away. The service hosts a
 * headless JS task that calls `runBackgroundDmWatch()` itself, so we don't
 * arm the subscription a SECOND time here when the native service is taking
 * over; we only fall back to running it inline when the native module is
 * absent (e.g. Expo Go, or a dev client predating the native build), where
 * the chip + subscription persist only while the app's JS context is alive.
 */
export async function startBackgroundDmWatch(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Without notification permission the watch is an invisible battery drain —
  // it can't post the status chip or any of the message alerts it exists to
  // deliver — so a missing/revoked permission is a hard stop, not a warning.
  const granted = await hasNotificationPermission().catch(() => false);
  if (!granted) {
    console.warn('[BgDmWatch] not started: notification permission missing');
    return;
  }
  try {
    if (isBackgroundDmServiceAvailable()) {
      // Native service owns the watch: it spins up a headless JS context and
      // runs the BackgroundDmTask (→ runBackgroundDmWatch) there. Arming it
      // here too would open a duplicate subscription — and the service posts
      // its own startForeground() chip, so posting the Expo sticky chip as
      // well would stack two ongoing entries in the shade.
      await startForegroundService();
    } else {
      // Fallback (native module absent — Expo Go / stale dev client): the
      // Expo sticky chip is the only status surface, and the subscription
      // runs inline in this JS context.
      const chipId = await showForegroundServiceNotification({
        title: 'Lightning Piggy is watching for messages',
        body: 'Tap to open. This keeps your messages arriving in the background.',
      });
      if (chipId === null) {
        console.warn('[BgDmWatch] not started: foreground chip could not be posted');
        return;
      }
      const armed = await runBackgroundDmWatch();
      if (!armed) {
        // Nothing to watch (no identity / no relays) — don't leave a chip
        // promising a watch that isn't running.
        await dismissForegroundServiceNotification();
      }
    }
  } catch (e) {
    // Don't leave a stray chip (or half-armed subscription) behind when the
    // start failed — clean up and log; callers don't handle a rejection here.
    console.warn('[BgDmWatch] start failed — cleaning up:', e);
    stopBackgroundDmWatchSubscription();
    await dismissForegroundServiceNotification();
  }
}

/**
 * Disable the background DM watch: close the subscription and dismiss the
 * persistent chip. Android-only; safe to call when nothing is running.
 */
export async function stopBackgroundDmWatch(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Stop the native service first: this tears down the headless JS context
  // (and the subscription running inside it). Best-effort — a transient
  // bridge error must not skip the rest of the cleanup below, or the watch
  // is left half-stopped with the chip still up.
  await stopForegroundService().catch((e) => {
    console.warn('[BgDmWatch] native stop failed (continuing cleanup):', e);
  });
  // Then close any inline subscription this foreground context owns (the
  // fallback path) and dismiss the chip.
  stopBackgroundDmWatchSubscription();
  await dismissForegroundServiceNotification();
}

/**
 * Bring the watch into line with the persisted preference. Call on app
 * launch / login so a user who enabled it last session has the chip +
 * subscription back. No-op when disabled or not Android.
 */
export async function syncBackgroundDmWatchFromPreference(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const enabled = await loadBackgroundDmEnabled();
  if (enabled) {
    await startBackgroundDmWatch();
  } else {
    await stopBackgroundDmWatch();
  }
}

/** Test hook: report whether a live subscription is currently armed. */
export function __isWatchActiveForTests(): boolean {
  return activeWatch !== null;
}

/** Test hook: tear down state between tests. */
export function __resetForTests(): void {
  stopBackgroundDmWatchSubscription();
}
