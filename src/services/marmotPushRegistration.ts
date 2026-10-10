// Device-level switch for Marmot push (MIP-05): owns the opt-in setting, the
// native FCM / APNs token, and which notification server it is sealed to,
// and hands the resulting registration to the active account's Marmot
// session (whose MarmotPushRegistrar announces it in each group).
//
// Off by default. Turning it on asks Apple/Google for this device's raw push
// token (`getDevicePushTokenAsync` — never Expo's push service); turning it
// off retracts the token from every group and deletes it at Apple/Google,
// which kills every copy the group members hold.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import * as Application from 'expo-application';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Notifications from 'expo-notifications';
import { nip19 } from 'nostr-tools';
import { Platform } from 'react-native';

import type { DeviceRegistration } from './marmotPushEntries';
import type { SyncResult } from './marmotPushRegistrar';
import { deviceTokenBytes, tokenFingerprint, type PushPlatform } from './marmotPushToken';
import { createPushTransport } from './marmotNetwork';
import { getMarmotSession, subscribeMarmotSession, type MarmotSession } from './marmotSession';
import { requestNotificationPermission } from './notificationService';
import { MARMOT_PUSH_WAKE_TASK, setLiveMarmotSession } from './marmotPushWake';

const ENABLED_KEY = 'marmot_push_enabled_v1';
/** Custom server: JSON `{ pubkey, relayHint? }`; absent = the built-in one. */
const SERVER_KEY = 'marmot_push_server_v1';
/** Set while a token deletion at Apple/Google still has to be retried. */
const RETIRE_PENDING_KEY = 'marmot_push_retire_pending_v1';
const TOKEN_TIMEOUT_MS = 20_000;
const RELAY_LOOKUP_TIMEOUT_MS = 8_000;

export interface PushServer {
  /** x-only pubkey, lowercase hex. */
  pubkey: string;
  relayHint?: string;
}

/**
 * Lightning Piggy's Transponder instances. Apple/Google only deliver with
 * the app's own credentials, so each app id has its own server (APNs topic =
 * that bundle id). Relay hints are fixed (each server lists nos.lol in its
 * kind-10050) so a hint lookup can never churn the signed records.
 *
 * The dev build has its own server: APNs SANDBOX environment, topic
 * `com.lightningpiggy.app.dev`, plus FCM. The APNs environment follows the
 * build's signing, not the bundle id: the iOS Simulator and locally built
 * (`expo run:ios`) dev clients get sandbox tokens (served), but an EAS-built
 * `.dev` app on a physical iPhone gets production tokens, which no server
 * serves for the `.dev` topic. Overridable at bundle time with
 * `EXPO_PUBLIC_MARMOT_PUSH_DEV_SERVER` (npub or hex; dev builds only).
 */
export const BUILT_IN_SERVERS: Record<'production' | 'preview' | 'development', PushServer> = {
  production: {
    pubkey: '653e35d79e65d33d99d6d623cc87101b2159008488a321a774b3bd1205ee6297',
    relayHint: 'wss://nos.lol',
  },
  preview: {
    pubkey: '1888abbc7706e75aac190b095b962f3a8fe3e3b8b32d96d3e18b917159d988f7',
    relayHint: 'wss://nos.lol',
  },
  development: {
    pubkey: 'a3270a0af61c5802d0688c5e8daf3dd6c4a34155e6df7c9225d4dafd04f64fcb',
    relayHint: 'wss://nos.lol',
  },
};

const DEV_SERVER_OVERRIDE = process.env.EXPO_PUBLIC_MARMOT_PUSH_DEV_SERVER ?? '';

export function builtInServer(
  appId: string | null = Application.applicationId,
  devOverride: string = DEV_SERVER_OVERRIDE,
): PushServer {
  if (appId === 'com.lightningpiggy.app') return BUILT_IN_SERVERS.production;
  if (appId === 'com.lightningpiggy.app.preview') return BUILT_IN_SERVERS.preview;
  const override = devOverride ? parseServerKey(devOverride) : null;
  return override ? { pubkey: override } : BUILT_IN_SERVERS.development;
}

/** Parse an npub / hex server key; null when it isn't a valid key. */
export function parseServerKey(input: string): string | null {
  const v = input.trim();
  let hex = v.toLowerCase();
  if (v.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(v);
      if (decoded.type !== 'npub') return null;
      hex = decoded.data;
    } catch {
      return null;
    }
  }
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  try {
    secp256k1.Point.fromHex(`02${hex}`); // must be a real curve point
    return hex;
  } catch {
    return null;
  }
}

export interface MarmotPushSettings {
  enabled: boolean;
  /** A custom server, or null for the built-in one. */
  customServer: PushServer | null;
}

/** The stored settings. Throws when storage can't be read — an unreadable
 * setting must never be taken for "off" or "default server". */
export async function loadMarmotPushSettings(): Promise<MarmotPushSettings> {
  const [enabled, server] = await Promise.all([
    AsyncStorage.getItem(ENABLED_KEY),
    AsyncStorage.getItem(SERVER_KEY),
  ]);
  let customServer: PushServer | null = null;
  try {
    const parsed = server ? (JSON.parse(server) as PushServer) : null;
    if (parsed && parseServerKey(parsed.pubkey)) customServer = parsed;
  } catch {
    customServer = null;
  }
  return { enabled: enabled === '1', customServer };
}

// --- runtime state -------------------------------------------------------------
//
// Every device-level change — startup restore, enable, disable, server
// change, account removal — runs on ONE chain, so a slow token read can
// never land after (and undo) a later change.

let settings: MarmotPushSettings = { enabled: false, customServer: null };
let settingsLoaded = false;
// undefined until known: the token is read asynchronously at start, and a
// session must not take "not read yet" for "push off" (it would retract).
let registration: DeviceRegistration | null | undefined = undefined;
let started = false;
// After an account removal deleted the token: the session to skip (the
// removed account's, being torn down) while waiting for the next one.
let awaitingSession: { stale: MarmotSession | null } | null = null;
let chain: Promise<unknown> = Promise.resolve();
const statusListeners = new Set<() => void>();
const watchedSessions = new WeakSet<MarmotSession>();
const notifyStatus = () => statusListeners.forEach((l) => l());

/** Fires whenever the token or a group pass settles — for the Settings status. */
export function subscribeMarmotPushStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}
// In-memory mirror of RETIRE_PENDING_KEY: no token is handed out meanwhile.
let retiring = false;

function serial<T>(op: () => Promise<T>): Promise<T> {
  const run = chain.then(op, op);
  chain = run.catch(() => undefined);
  return run;
}

let hydrating: Promise<void> | null = null;

/** Hydrate once — one shared read, applied only if no change has set the
 * settings meanwhile (a late read must never resurrect "on"). Throws (and
 * retries next time) when storage is unreadable. */
function ensureSettings(): Promise<void> {
  if (settingsLoaded) return Promise.resolve();
  hydrating ??= loadMarmotPushSettings()
    .then((stored) => {
      if (settingsLoaded) return;
      settings = stored;
      settingsLoaded = true;
    })
    .finally(() => {
      hydrating = null;
    });
  return hydrating;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('push: timed out')), ms)),
  ]);

// expo-notifications' getDevicePushTokenAsync() keeps a REJECTED promise
// cached until the JS runtime restarts, so one transient failure (offline,
// Play services busy) would stick. Ask the native module directly instead.
const nativeTokens = requireOptionalNativeModule<{ getDevicePushTokenAsync(): Promise<string> }>(
  'ExpoPushTokenManager',
);
const readNativeToken = async (): Promise<{ type: string; data: unknown }> =>
  nativeTokens
    ? { type: Platform.OS, data: await nativeTokens.getDevicePushTokenAsync() }
    : Notifications.getDevicePushTokenAsync();

/** This device's native token as a registration for `server`. */
async function readRegistration(server: PushServer): Promise<DeviceRegistration> {
  const native = await withTimeout(readNativeToken(), TOKEN_TIMEOUT_MS);
  return toRegistration(native.type === 'ios' ? 'apns' : 'fcm', String(native.data), server);
}

function toRegistration(platform: PushPlatform, raw: string, server: PushServer) {
  const token = deviceTokenBytes(platform, raw);
  return {
    platform,
    token,
    fingerprint: tokenFingerprint(platform, token),
    server: server.pubkey,
    ...(server.relayHint ? { relayHint: server.relayHint } : {}),
  };
}

const currentServer = () => settings.customServer ?? builtInServer();

/** Hand the registration to `session` and sync it in the background. */
function applyTo(session: MarmotSession | null): void {
  setLiveMarmotSession(session !== null);
  notifyStatus();
  if (!session) return;
  if (!watchedSessions.has(session)) {
    watchedSessions.add(session);
    session.pushRegistration.onSettled(notifyStatus);
  }
  if (awaitingSession && session !== awaitingSession.stale) {
    awaitingSession = null;
    void serial(() => refreshAfterRetirement(session));
    return;
  }
  if (registration === undefined) return;
  session.pushRegistration.setRegistration(registration);
  session.pushRegistration.schedule();
}

/** A user-initiated pass over the active account's groups ("Finish setup"):
 * a remote signer may prompt. */
export function syncMarmotPushNow(): Promise<SyncResult | null> {
  return serial(syncActiveSession);
}

async function syncActiveSession(): Promise<SyncResult | null> {
  const session = getMarmotSession();
  if (!session) return null;
  // On but no token yet (the startup read failed): retry it now.
  if (registration === undefined && settings.enabled && !retiring && !awaitingSession) {
    try {
      registration = await readRegistration(currentServer());
      await registerWakeTask();
    } catch {
      return null;
    }
  }
  if (registration === undefined) return null;
  session.pushRegistration.setRegistration(registration);
  return session.pushRegistration.sync({ interactive: true });
}

/**
 * Once, at app start: restore the setting, refresh the token without
 * prompting, and keep every future session registered. Never asks a remote
 * signer — changed groups wait for a user action (see MarmotPushRegistrar).
 */
export function startMarmotPushRegistration(): () => void {
  if (started) return () => undefined;
  started = true;
  const unsubscribe = subscribeMarmotSession(applyTo);
  const tokenSub = Notifications.addPushTokenListener((native) => {
    void serial(async () => {
      // Also recovers a startup read that failed / timed out: a token that
      // arrives later is taken — unless a deletion is still outstanding or
      // we're waiting for another account after an account removal.
      if (!settings.enabled || retiring || awaitingSession) return;
      try {
        const platform = native.type === 'ios' ? 'apns' : 'fcm';
        registration = toRegistration(platform, String(native.data), currentServer());
        await registerWakeTask();
        applyTo(getMarmotSession());
      } catch {
        // malformed token — keep the previous registration
      }
    });
  });
  void serial(async () => {
    try {
      await ensureSettings();
    } catch {
      notifyStatus(); // unreadable: stay "unknown" — publish nothing, retract nothing
      return;
    }
    // A deletion that failed last time (offline): finish it first, and only
    // then hand out a token again.
    if (await retirementPending()) {
      if (!(await retireDeviceToken())) return;
    }
    if (settings.enabled) {
      try {
        registration = await readRegistration(currentServer());
        await registerWakeTask();
      } catch (e) {
        // Offline / no token right now: keep whatever the groups have.
        if (__DEV__) console.warn('[MarmotPush] token refresh failed:', e);
        notifyStatus();
        return;
      }
    } else {
      // Off: retract anything still published (e.g. turned off while the
      // account's session wasn't running).
      registration = null;
    }
    applyTo(getMarmotSession());
  });
  return () => {
    unsubscribe();
    tokenSub.remove();
    started = false;
  };
}

export type EnableOutcome =
  | { status: 'enabled'; sync: SyncResult | null }
  | { status: 'no-permission' }
  /** No token from Apple/Google — e.g. no Google Play services. */
  | { status: 'unavailable' };

/** Turn push on (user action): permission, token, then every group. */
export async function enableMarmotPush(): Promise<EnableOutcome> {
  if (!(await requestNotificationPermission())) return { status: 'no-permission' };
  return serial(enableNow);
}

async function enableNow(): Promise<EnableOutcome> {
  try {
    await ensureSettings();
  } catch {
    return { status: 'unavailable' };
  }
  // An old token still waiting to be deleted: try once more. Either way the
  // user now wants push on, so the marker can't be left to delete the token
  // we're about to hand out at the next start.
  if (await retirementPending()) {
    await retireDeviceToken();
    // The marker must be gone for good before a new token is handed out,
    // or the next start would delete it.
    try {
      await AsyncStorage.removeItem(RETIRE_PENDING_KEY);
    } catch {
      return { status: 'unavailable' };
    }
    retiring = false;
  }
  let next: DeviceRegistration;
  try {
    next = await readRegistration(currentServer());
  } catch (e) {
    if (__DEV__) console.warn('[MarmotPush] no device token:', e);
    return { status: 'unavailable' };
  }
  // Persist first, then commit: a failed write must leave push off.
  try {
    await AsyncStorage.setItem(ENABLED_KEY, '1');
  } catch {
    return { status: 'unavailable' };
  }
  settings.enabled = true;
  settingsLoaded = true;
  registration = next;
  await registerWakeTask();
  return { status: 'enabled', sync: await syncActiveSession() };
}

export interface DisableOutcome {
  sync: SyncResult | null;
  /** False when Apple/Google couldn't be reached — retried at next start. */
  tokenDeleted: boolean;
  /** False when the "off" setting couldn't be stored (it may come back on). */
  saved: boolean;
}

/** Turn push off (user action): retract from every group, then delete the
 * token at Apple/Google so copies the members already hold stop working. */
export function disableMarmotPush(): Promise<DisableOutcome> {
  return serial(async () => {
    // Explicitly off — an unreadable store doesn't change that.
    await ensureSettings().catch(() => undefined);
    settings.enabled = false;
    settingsLoaded = true; // explicit now — no late read may override it
    registration = null;
    // Retract + revoke regardless of whether the setting could be saved.
    const saved = await AsyncStorage.setItem(ENABLED_KEY, '0').then(
      () => true,
      () => false,
    );
    const sync = await syncActiveSession().catch(() => null);
    const tokenDeleted = await retireDeviceToken();
    return { sync, tokenDeleted, saved };
  });
}

/** Use `server` (or the built-in one, for null) — re-registers if on. */
export async function setMarmotPushServer(pubkey: string | null): Promise<EnableOutcome | null> {
  let custom: PushServer | null = null;
  if (pubkey) {
    const hex = parseServerKey(pubkey);
    if (!hex) throw new Error('push: invalid server key');
    custom = { pubkey: hex, ...(await lookupRelayHint(hex)) };
  }
  return serial(async () => {
    await ensureSettings();
    if (custom) await AsyncStorage.setItem(SERVER_KEY, JSON.stringify(custom));
    else await AsyncStorage.removeItem(SERVER_KEY);
    settings.customServer = custom;
    if (!settings.enabled) return null;
    // Same phone token, new server: re-seal it — no new token read that
    // could fail half-way through the change.
    if (registration) {
      const server = currentServer();
      const { platform, token, fingerprint } = registration;
      registration = {
        platform,
        token,
        fingerprint,
        server: server.pubkey,
        ...(server.relayHint ? { relayHint: server.relayHint } : {}),
      };
      return { status: 'enabled', sync: await syncActiveSession() };
    }
    return enableNow();
  });
}

/** Groups of the active account still waiting for a signature. */
/** Groups of the active account still waiting for a signature; null when
 * push is on but this phone has no token yet (Finish setup retries it). */
export async function pendingMarmotPushGroups(): Promise<number | null> {
  if (
    !(await ensureSettings().then(
      () => true,
      () => false,
    ))
  )
    return null;
  const session = getMarmotSession();
  if (settings.enabled && registration === undefined) return null;
  if (!session || registration === undefined) return 0;
  session.pushRegistration.setRegistration(registration);
  return session.pushRegistration.pendingCount();
}

/**
 * An account is being removed from this device. Its signer is already gone,
 * so it can't sign removals: delete the token at Apple/Google instead (on
 * Android every copy in that account's groups goes dead; iOS may hand the
 * same APNs token back later, so there revocation is best-effort — MIP-05
 * "Best-effort revocation"). Only once the deletion succeeded (else it is
 * retried at the next start, before any token is handed out) is a fresh
 * token fetched — when another account's session runs — and that account's
 * groups re-signed as part of this user action (a remote signer may prompt).
 * Returns false when the deletion has to be retried.
 */
export function retireMarmotPushForAccount(pubkey: string): Promise<boolean> {
  return serial(async () => {
    // Unreadable settings: assume it was on — deleting a token is the safe side.
    const known = await ensureSettings().then(
      () => true,
      () => false,
    );
    if (known && !settings.enabled) return true;
    registration = undefined;
    if (!(await retireDeviceToken())) return false;
    const current = getMarmotSession();
    if (current && current.pubkey !== pubkey) await refreshAfterRetirement(current);
    else awaitingSession = { stale: current };
    return true;
  });
}

async function refreshAfterRetirement(session: MarmotSession): Promise<void> {
  if (!settings.enabled || (await retirementPending())) return;
  try {
    registration = await readRegistration(currentServer());
  } catch {
    return; // unknown, not "off" — the next start retries
  }
  session.pushRegistration.setRegistration(registration);
  void session.pushRegistration.sync({ interactive: true }).catch(() => undefined);
}

/** An unreadable marker counts as pending: handing out a token that should
 * have been deleted is the worse mistake. */
const retirementPending = async () => {
  retiring = (await AsyncStorage.getItem(RETIRE_PENDING_KEY).catch(() => '1')) === '1';
  return retiring;
};

/** Delete the token at Apple/Google; on failure remember to retry. */
async function retireDeviceToken(): Promise<boolean> {
  let deleted = true;
  try {
    await Notifications.unregisterForNotificationsAsync();
    await AsyncStorage.removeItem(RETIRE_PENDING_KEY);
    retiring = false;
  } catch {
    deleted = false;
    retiring = true;
    await AsyncStorage.setItem(RETIRE_PENDING_KEY, '1').catch(() => undefined);
  }
  if (Platform.OS === 'android' && !settings.enabled) {
    await Notifications.unregisterTaskAsync(MARMOT_PUSH_WAKE_TASK).catch(() => undefined);
  }
  return deleted;
}

/** Android delivers our (data-only) push to this task; iOS shows the
 * server's alert itself. */
async function registerWakeTask(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.registerTaskAsync(MARMOT_PUSH_WAKE_TASK).catch(() => undefined);
}

/** The first inbox relay a custom server lists (kind 10050), as its hint. */
async function lookupRelayHint(server: string): Promise<{ relayHint?: string }> {
  try {
    const relays = await withTimeout(
      createPushTransport(() => []).inboxRelays(server),
      RELAY_LOOKUP_TIMEOUT_MS,
    );
    return relays[0] ? { relayHint: relays[0] } : {};
  } catch {
    return {};
  }
}

/** Test seam: forget module state between tests. */
export function __resetMarmotPushForTests(): void {
  settings = { enabled: false, customServer: null };
  settingsLoaded = false;
  hydrating = null;
  registration = undefined;
  awaitingSession = null;
  retiring = false;
  chain = Promise.resolve();
}
