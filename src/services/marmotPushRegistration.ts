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
import * as Notifications from 'expo-notifications';
import { nip19 } from 'nostr-tools';
import { Platform } from 'react-native';

import type { DeviceRegistration } from './marmotPushEntries';
import type { SyncResult } from './marmotPushRegistrar';
import { deviceTokenBytes, tokenFingerprint, type PushPlatform } from './marmotPushToken';
import { createPushTransport } from './marmotNetwork';
import { getMarmotSession, subscribeMarmotSession, type MarmotSession } from './marmotSession';
import { requestNotificationPermission, setMarmotRemoteAlertsEnabled } from './notificationService';
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
 * the app's own credentials, so each app id has its own server. The dev
 * build shares the preview server (same Firebase project → FCM works; its
 * APNs topic is the preview bundle id, so iOS dev builds get no pushes).
 * Relay hints are fixed (each server lists nos.lol in its kind-10050) so a
 * hint lookup can never churn the signed records.
 */
export const BUILT_IN_SERVERS: Record<'production' | 'preview', PushServer> = {
  production: {
    pubkey: '653e35d79e65d33d99d6d623cc87101b2159008488a321a774b3bd1205ee6297',
    relayHint: 'wss://nos.lol',
  },
  preview: {
    pubkey: '1888abbc7706e75aac190b095b962f3a8fe3e3b8b32d96d3e18b917159d988f7',
    relayHint: 'wss://nos.lol',
  },
};

export function builtInServer(appId: string | null = Application.applicationId): PushServer {
  return appId === 'com.lightningpiggy.app'
    ? BUILT_IN_SERVERS.production
    : BUILT_IN_SERVERS.preview;
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

export async function loadMarmotPushSettings(): Promise<MarmotPushSettings> {
  const [enabled, server] = await Promise.all([
    AsyncStorage.getItem(ENABLED_KEY).catch(() => null),
    AsyncStorage.getItem(SERVER_KEY).catch(() => null),
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

let settings: MarmotPushSettings = { enabled: false, customServer: null };
// undefined until known: the token is read asynchronously at start, and a
// session must not take "not read yet" for "push off" (it would retract).
let registration: DeviceRegistration | null | undefined = undefined;
let started = false;
// After an account removal deleted the token: the session to skip (the
// removed account's, being torn down) while waiting for the next one.
let awaitingSession: { stale: MarmotSession | null } | null = null;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('push: timed out')), ms)),
  ]);

/** This device's native token as a registration for `server`. */
async function readRegistration(server: PushServer): Promise<DeviceRegistration> {
  const native = await withTimeout(Notifications.getDevicePushTokenAsync(), TOKEN_TIMEOUT_MS);
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

/** iOS: while push is on, the server's alert speaks for a backgrounded app. */
const updateRemoteAlerts = () =>
  setMarmotRemoteAlertsEnabled(Platform.OS === 'ios' && settings.enabled && !!registration);

/** Hand the registration to `session` and sync it in the background. */
function applyTo(session: MarmotSession | null): void {
  setLiveMarmotSession(session !== null);
  if (!session) return;
  if (awaitingSession && session !== awaitingSession.stale) {
    awaitingSession = null;
    void refreshAfterRetirement(session);
    return;
  }
  if (registration === undefined) return;
  session.pushRegistration.setRegistration(registration);
  session.pushRegistration.schedule();
}

/** A user-initiated pass over the active account's groups ("Finish setup"):
 * a remote signer may prompt. */
export async function syncMarmotPushNow(): Promise<SyncResult | null> {
  const session = getMarmotSession();
  if (!session || registration === undefined) return null;
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
    if (!settings.enabled) return;
    try {
      const platform = native.type === 'ios' ? 'apns' : 'fcm';
      registration = toRegistration(platform, String(native.data), currentServer());
      applyTo(getMarmotSession());
    } catch {
      // malformed token — keep the previous registration
    }
  });
  void (async () => {
    settings = await loadMarmotPushSettings();
    // A deletion that failed last time (offline): finish it first.
    if (await AsyncStorage.getItem(RETIRE_PENDING_KEY).catch(() => null)) {
      await retireDeviceToken();
    }
    if (settings.enabled) {
      try {
        registration = await readRegistration(currentServer());
        await registerWakeTask();
      } catch (e) {
        // Offline / no token right now: keep whatever the groups have.
        if (__DEV__) console.warn('[MarmotPush] token refresh failed:', e);
        return;
      }
    } else {
      // Off: retract anything still published (e.g. turned off while the
      // account's session wasn't running).
      registration = null;
    }
    updateRemoteAlerts();
    applyTo(getMarmotSession());
  })();
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
  settings = await loadMarmotPushSettings();
  try {
    registration = await readRegistration(currentServer());
  } catch (e) {
    if (__DEV__) console.warn('[MarmotPush] no device token:', e);
    return { status: 'unavailable' };
  }
  settings.enabled = true;
  await AsyncStorage.setItem(ENABLED_KEY, '1');
  await registerWakeTask();
  updateRemoteAlerts();
  return { status: 'enabled', sync: await syncMarmotPushNow() };
}

export interface DisableOutcome {
  sync: SyncResult | null;
  /** False when Apple/Google couldn't be reached — retried at next start. */
  tokenDeleted: boolean;
}

/** Turn push off (user action): retract from every group, then delete the
 * token at Apple/Google so copies the members already hold stop working. */
export async function disableMarmotPush(): Promise<DisableOutcome> {
  settings.enabled = false;
  await AsyncStorage.setItem(ENABLED_KEY, '0');
  registration = null;
  updateRemoteAlerts();
  const sync = await syncMarmotPushNow().catch(() => null);
  return { sync, tokenDeleted: await retireDeviceToken() };
}

/** Use `server` (or the built-in one, for null) — re-registers if on. */
export async function setMarmotPushServer(pubkey: string | null): Promise<EnableOutcome | null> {
  let custom: PushServer | null = null;
  if (pubkey) {
    const hex = parseServerKey(pubkey);
    if (!hex) throw new Error('push: invalid server key');
    custom = { pubkey: hex, ...(await lookupRelayHint(hex)) };
  }
  if (custom) await AsyncStorage.setItem(SERVER_KEY, JSON.stringify(custom));
  else await AsyncStorage.removeItem(SERVER_KEY);
  settings.customServer = custom;
  if (!settings.enabled) return null;
  return enableMarmotPush();
}

/** Groups of the active account still waiting for a signature. */
export async function pendingMarmotPushGroups(): Promise<number> {
  const session = getMarmotSession();
  if (!session || registration === undefined) return 0;
  session.pushRegistration.setRegistration(registration);
  return session.pushRegistration.pendingCount();
}

/**
 * An account is being removed from this device. Its signer is already gone,
 * so it can't sign removals: delete the token at Apple/Google instead (on
 * Android every copy in that account's groups goes dead; iOS may hand the
 * same APNs token back later, so there revocation is best-effort — MIP-05
 * "Best-effort revocation"). A fresh token is only fetched once another
 * account's session is running, and its groups are re-signed then as part
 * of this user action (a remote signer may prompt).
 */
export async function retireMarmotPushForAccount(pubkey: string): Promise<void> {
  if (!settings.enabled) return;
  registration = undefined;
  updateRemoteAlerts();
  await retireDeviceToken();
  const current = getMarmotSession();
  if (current && current.pubkey !== pubkey) {
    await refreshAfterRetirement(current);
    return;
  }
  awaitingSession = { stale: current };
}

async function refreshAfterRetirement(session: MarmotSession): Promise<void> {
  if (!settings.enabled) return;
  try {
    registration = await readRegistration(currentServer());
  } catch {
    return; // unknown, not "off" — the next start retries
  }
  updateRemoteAlerts();
  session.pushRegistration.setRegistration(registration);
  void session.pushRegistration.sync({ interactive: true }).catch(() => undefined);
}

/** Delete the token at Apple/Google; on failure remember to retry. */
async function retireDeviceToken(): Promise<boolean> {
  let deleted = true;
  try {
    await Notifications.unregisterForNotificationsAsync();
    await AsyncStorage.removeItem(RETIRE_PENDING_KEY);
  } catch {
    deleted = false;
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
