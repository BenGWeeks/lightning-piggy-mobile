// Marmot push (MIP-05): owns each account's opt-in, this device's native
// FCM / APNs token, and which notification server it is sealed to, and hands
// the resulting registration to the running account's Marmot session (whose
// MarmotPushRegistrar announces it in each group).
//
// The opt-in is PER ACCOUNT and off by default. The phone has one token, so
// every account that turns push on shows the same token fingerprint in its
// chats — two accounts on one phone (e.g. a parent and a smart saver) would
// become linkable. So an account only ever publishes the token after its own
// opt-in; switching to (or adding) another account never registers it.
//
// Turning it on asks Apple/Google for this device's raw push token
// (`getDevicePushTokenAsync` — never Expo's push service); turning it off
// retracts the token from that account's groups and, once no account on the
// phone uses push, deletes it at Apple/Google, which kills every copy the
// group members hold.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as Application from 'expo-application';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { nip19 } from 'nostr-tools';
import { Platform } from 'react-native';

import type { DeviceRegistration } from './marmotPushEntries';
import type { SyncResult } from './marmotPushRegistrar';
import { deviceTokenBytes, tokenFingerprint, type PushPlatform } from './marmotPushToken';
import { createPushTransport } from './marmotNetwork';
import { perAccountKey } from './perAccountStorage';
import { getActivePubkey } from './walletStorageService';
import { getMarmotSession, subscribeMarmotSession, type MarmotSession } from './marmotSession';
import { requestNotificationPermission } from './notificationService';
import { MARMOT_PUSH_WAKE_TASK, setLiveMarmotSession } from './marmotPushWake';

/** Per account (`perAccountKey`): '1' = this account opted in. */
const ENABLED_KEY = 'marmot_push_enabled_v1';
const ENABLED_PREFIX = `${ENABLED_KEY}_`;
/** Custom server: JSON `{ pubkey, relayHint? }`; absent = the built-in one. */
const SERVER_KEY = 'marmot_push_server_v1';
/** SecureStore (a second store, so it holds when AsyncStorage won't): JSON
 * list of removed accounts whose opt-in key couldn't be deleted — honoured
 * and retried at every hydration, so a re-login never revives the opt-in. */
const FORGOTTEN_KEY = 'marmot_push_forgotten_v1';
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
  /** This account opted in. */
  enabled: boolean;
  /** Another account on this phone has push on — enabling here makes the
   * two linkable by anyone who chats with both (same token fingerprint). */
  otherAccounts: boolean;
  /** A custom server (device-wide), or null for the built-in one. */
  customServer: PushServer | null;
}

interface StoredSettings {
  /** Accounts (lowercase hex) that opted in. */
  enabledAccounts: Set<string>;
  /** Accounts that ever opted in ('1' or '0' stored): their groups may still
   * hold the token if a retraction never completed. */
  everEnabled: Set<string>;
  customServer: PushServer | null;
}

const accountKey = (pubkey: string) => perAccountKey(ENABLED_KEY, pubkey.toLowerCase());

/** Every account's opt-in plus the server. Throws when storage can't be read
 * — an unreadable setting must never be taken for "off" or "default server". */
async function readStoredSettings(): Promise<StoredSettings> {
  // Bound before any await: an account switch mid-read can't move it.
  const legacyOwner = (getActivePubkey() ?? getMarmotSession()?.pubkey)?.toLowerCase();
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(ENABLED_PREFIX));
  const [entries, server, legacy] = await Promise.all([
    keys.length ? AsyncStorage.multiGet(keys) : Promise.resolve([] as [string, string | null][]),
    AsyncStorage.getItem(SERVER_KEY),
    AsyncStorage.getItem(ENABLED_KEY),
  ]);
  const account = (k: string) => k.slice(ENABLED_PREFIX.length);
  const enabledAccounts = new Set(entries.filter(([, v]) => v === '1').map(([k]) => account(k)));
  const forgotten = await readForgotten();
  if (forgotten.length > 0) {
    const remaining: string[] = [];
    for (const a of forgotten) {
      enabledAccounts.delete(a);
      const removed = await AsyncStorage.removeItem(accountKey(a)).then(
        () => true,
        () => false,
      );
      if (!removed) remaining.push(a);
    }
    if (remaining.length < forgotten.length) await writeForgotten(remaining).catch(() => undefined);
  }
  const everEnabled = new Set(keys.map(account));
  // Builds before the per-account opt-in had one device-wide switch: it
  // belongs to the account that was active then — never to the others, and
  // never over any per-account choice already recorded (e.g. a later "off").
  if (legacy !== null) {
    if (legacy === '1' && keys.length === 0) {
      // Owner not known yet: "unreadable" for now — touch nothing, retry.
      if (!legacyOwner) throw new Error('push: legacy opt-in owner not known yet');
      await AsyncStorage.setItem(accountKey(legacyOwner), '1');
      enabledAccounts.add(legacyOwner);
      everEnabled.add(legacyOwner);
    }
    await AsyncStorage.removeItem(ENABLED_KEY);
  }
  let customServer: PushServer | null = null;
  try {
    const parsed = server ? (JSON.parse(server) as PushServer) : null;
    if (parsed && parseServerKey(parsed.pubkey)) customServer = parsed;
  } catch {
    customServer = null;
  }
  return { enabledAccounts, everEnabled, customServer };
}

async function readForgotten(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(FORGOTTEN_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return []; // corrupt: nothing recoverable in it
  }
}

async function writeForgotten(accounts: string[]): Promise<void> {
  if (accounts.length === 0) await SecureStore.deleteItemAsync(FORGOTTEN_KEY);
  else await SecureStore.setItemAsync(FORGOTTEN_KEY, JSON.stringify(accounts));
}

/** `pubkey`'s settings — the one shared hydration plus this run's changes.
 * Throws when storage can't be read. */
export async function loadMarmotPushSettings(pubkey: string): Promise<MarmotPushSettings> {
  await ensureSettings();
  const me = pubkey.toLowerCase();
  return {
    enabled: isEnabled(me),
    otherAccounts: enabledAccounts().some((a) => a !== me),
    customServer: settings.customServer,
  };
}

// --- runtime state -------------------------------------------------------------
//
// Every device-level change — startup restore, enable, disable, server
// change, account removal — runs on ONE chain, so a slow token read can
// never land after (and undo) a later change.

let settings: StoredSettings = {
  enabledAccounts: new Set(),
  everEnabled: new Set(),
  customServer: null,
};
let settingsLoaded = false;
// This run's explicit per-account changes (enable / disable / removal). They
// win over the stored set, so a late or failed read can never resurrect "on"
// for an account the user just turned off — nor drop another account's
// opt-in it never touched.
const explicit = new Map<string, boolean>();
// This phone's token, sealed to the current server — held while ANY account
// uses push; null once none does. undefined until known: the token is read
// asynchronously at start, and a session must not take "not read yet" for
// "push off" (it would retract).
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

// --- the device token, shared with the notification watcher ----------------------

/** This phone's raw native push token, as the notification watcher takes it. */
export interface PushDevice {
  platform: PushPlatform;
  /** APNs: lowercase hex. FCM: the opaque token string. */
  token: string;
}
const deviceListeners = new Set<() => void>();
const deviceKey = (r: DeviceRegistration | null | undefined) =>
  r === undefined ? 'unknown' : r === null ? 'off' : r.fingerprint;
const notifyDevice = () => deviceListeners.forEach((l) => l());

/** Every token change goes through here, so the watcher hears about it.
 * True when it announced one. */
function setDeviceRegistration(next: DeviceRegistration | null | undefined): boolean {
  const changed = deviceKey(next) !== deviceKey(registration);
  registration = next;
  if (changed) notifyDevice();
  return changed;
}

/** The device token for `pubkey` — only if THAT account turned push on (the
 * watcher registers per account, and must never carry the token for an
 * account that didn't opt in). undefined until known, null when off. */
export function currentPushDevice(pubkey: string | null): PushDevice | null | undefined {
  if (!pubkey) return null;
  const reg = registrationFor(pubkey);
  if (!reg) return reg;
  const { platform, token } = reg;
  return {
    platform,
    // FCM tokens are ASCII ([A-Za-z0-9_:.-]); APNs tokens travel as hex.
    token: platform === 'apns' ? bytesToHex(token) : String.fromCharCode(...token),
  };
}

/** Fires when the token appears or changes, or an account turns push on/off. */
export function subscribePushDevice(listener: () => void): () => void {
  deviceListeners.add(listener);
  return () => deviceListeners.delete(listener);
}
// In-memory mirror of RETIRE_PENDING_KEY: no token is handed out meanwhile.
let retiring = false;

function serial<T>(op: () => Promise<T>): Promise<T> {
  const run = chain.then(op, op);
  chain = run.catch(() => undefined);
  return run;
}

let hydrating: Promise<void> | null = null;

/** Hydrate once — one shared read; this run's explicit changes stay on top
 * of it (see `explicit`). Throws (and retries next time) when storage is
 * unreadable. */
function ensureSettings(): Promise<void> {
  if (settingsLoaded) return Promise.resolve();
  hydrating ??= readStoredSettings()
    .then((stored: StoredSettings) => {
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
const isEnabled = (pubkey: string): boolean => {
  const me = pubkey.toLowerCase();
  return explicit.get(me) ?? settings.enabledAccounts.has(me);
};
/** Accounts with push on (stored, with this run's changes on top). */
const enabledAccounts = (): string[] => [
  ...new Set([
    ...[...settings.enabledAccounts].filter((a) => explicit.get(a) !== false),
    ...[...explicit].filter(([, on]) => on).map(([a]) => a),
  ]),
];
const anyEnabled = (): boolean => enabledAccounts().length > 0;

/** What `pubkey`'s groups should carry: this phone's token only if that
 * account opted in, null (retract) if it didn't, undefined while unknown. */
function registrationFor(pubkey: string): DeviceRegistration | null | undefined {
  const me = pubkey.toLowerCase();
  if (!explicit.has(me) && !settingsLoaded) return undefined;
  return isEnabled(me) ? registration : null;
}

/** Hand `session` its account's registration and sync it in the background. */
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
  const reg = registrationFor(session.pubkey);
  if (reg === undefined) return;
  session.pushRegistration.setRegistration(reg);
  session.pushRegistration.schedule();
}

/** A user-initiated pass over `pubkey`'s groups ("Finish setup"): a remote
 * signer may prompt. */
export function syncMarmotPushNow(pubkey: string): Promise<SyncResult | null> {
  return serial(() => syncAccountSession(pubkey));
}

/** Sync the running session — only if it is `pubkey`'s (an account switch
 * mid-action must not touch the next account's groups). */
async function syncAccountSession(pubkey: string): Promise<SyncResult | null> {
  const session = getMarmotSession();
  if (!session || session.pubkey.toLowerCase() !== pubkey.toLowerCase()) return null;
  // On but no token yet (the startup read failed): retry it now.
  if (registration === undefined && isEnabled(pubkey) && !retiring && !awaitingSession) {
    try {
      setDeviceRegistration(await readRegistration(currentServer()));
      await registerWakeTask();
    } catch {
      return null;
    }
  }
  const reg = registrationFor(pubkey);
  if (reg === undefined) return null;
  session.pushRegistration.setRegistration(reg);
  return session.pushRegistration.sync({ interactive: true });
}

/**
 * Once, at app start: restore the settings, refresh the token without
 * prompting, and keep every future session in line with ITS account's
 * opt-in. Never asks a remote signer — changed groups wait for a user action
 * (see MarmotPushRegistrar).
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
      if (!anyEnabled() || retiring || awaitingSession) return;
      try {
        const platform = native.type === 'ios' ? 'apns' : 'fcm';
        setDeviceRegistration(toRegistration(platform, String(native.data), currentServer()));
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
    if (anyEnabled()) {
      try {
        setDeviceRegistration(await readRegistration(currentServer()));
        await registerWakeTask();
      } catch (e) {
        // Offline / no token right now: keep whatever the groups have.
        if (__DEV__) console.warn('[MarmotPush] token refresh failed:', e);
        notifyStatus();
        return;
      }
    } else {
      // Off everywhere: retract anything still published (e.g. turned off
      // while the account's session wasn't running).
      setDeviceRegistration(null);
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

/** Turn push on for `pubkey` (user action): permission, token, then that
 * account's groups. Other accounts on the phone are left as they are. */
export async function enableMarmotPush(pubkey: string): Promise<EnableOutcome> {
  if (!(await requestNotificationPermission())) return { status: 'no-permission' };
  return serial(() => enableNow(pubkey));
}

async function enableNow(pubkey: string): Promise<EnableOutcome> {
  try {
    await ensureSettings();
  } catch {
    return { status: 'unavailable' };
  }
  // An old token still waiting to be deleted (e.g. a removed account's,
  // whose groups may still hold it): it must really be gone before this
  // account publishes a token — else the two would be linkable. Retryable.
  if ((await retirementPending()) && !(await retireDeviceToken())) {
    return { status: 'unavailable' };
  }
  let next: DeviceRegistration;
  try {
    next = await readRegistration(currentServer());
  } catch (e) {
    if (__DEV__) console.warn('[MarmotPush] no device token:', e);
    return { status: 'unavailable' };
  }
  // Persist first, then commit: a failed write must leave push off. Then
  // lift a tombstone from an earlier removal of this account (it would turn
  // the fresh opt-in back off at the next start) — only after the opt-in is
  // written, so a failure never leaves a stale '1' unprotected.
  try {
    await AsyncStorage.setItem(accountKey(pubkey), '1');
  } catch {
    return { status: 'unavailable' };
  }
  try {
    const forgotten = await readForgotten();
    const me = pubkey.toLowerCase();
    if (forgotten.includes(me)) await writeForgotten(forgotten.filter((a) => a !== me));
  } catch {
    await AsyncStorage.setItem(accountKey(pubkey), '0').catch(() => undefined);
    return { status: 'unavailable' };
  }
  explicit.set(pubkey.toLowerCase(), true);
  // This account's token appeared, even if the phone's didn't change.
  if (!setDeviceRegistration(next)) notifyDevice();
  await registerWakeTask();
  return { status: 'enabled', sync: await syncAccountSession(pubkey) };
}

export interface DisableOutcome {
  sync: SyncResult | null;
  /** False when Apple/Google couldn't be reached — retried at next start.
   * True too when the token is kept because another account still uses it. */
  tokenDeleted: boolean;
  /** False when the "off" setting couldn't be stored (it may come back on). */
  saved: boolean;
}

/** Turn push off for `pubkey` (user action): retract from its groups, then
 * — once no account on the phone uses push — delete the token at
 * Apple/Google so copies the members already hold stop working. */
export function disableMarmotPush(
  pubkey: string,
  /** Something else (the notification watcher) may still hold the token for
   * this account: never keep it for the other accounts. */
  opts: { stillRegistered?: boolean } = {},
): Promise<DisableOutcome> {
  return serial(async () => {
    // Explicitly off — an unreadable store doesn't change that.
    const known = await ensureSettings().then(
      () => true,
      () => false,
    );
    explicit.set(pubkey.toLowerCase(), false); // no late read may override it
    // Unknown whether others use it: treat as none (revoking is the safe side).
    const othersUsePush = known && anyEnabled();
    // Gone for this account either way — an in-flight watcher registration
    // for it must not land.
    if (othersUsePush) notifyDevice();
    else setDeviceRegistration(null);
    // Retract + revoke regardless of whether the setting could be saved.
    const saved = await AsyncStorage.setItem(accountKey(pubkey), '0').then(
      () => true,
      () => false,
    );
    const session = getMarmotSession();
    const sync = await syncAccountSession(pubkey).catch(() => null);
    // Another account still uses the token. If every one of this account's
    // groups took the signed removal, that is its retraction — keep the token.
    // Otherwise (declined, failed, or not this account's session) its groups
    // may still hold it, linking it to the other account: replace the token.
    const retracted =
      !opts.stillRegistered &&
      !!session &&
      !!sync &&
      !sync.declined &&
      sync.pending === 0 &&
      getMarmotSession() === session && // not cut short by an account switch
      !(await session.pushRegistration.holdsRecords().catch(() => true));
    const tokenDeleted = !othersUsePush
      ? await retireDeviceToken()
      : retracted || (await rotateDeviceToken());
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
    if (!anyEnabled()) return null;
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
      const active = getMarmotSession()?.pubkey;
      return { status: 'enabled', sync: active ? await syncAccountSession(active) : null };
    }
    const active = getActivePubkey();
    return active && isEnabled(active) ? enableNow(active) : null;
  });
}

/** `pubkey`'s groups still waiting for a signature; null when its push is
 * on but this phone has no token yet (Finish setup retries it). */
export async function pendingMarmotPushGroups(pubkey: string): Promise<number | null> {
  if (
    !(await ensureSettings().then(
      () => true,
      () => false,
    ))
  )
    return null;
  if (isEnabled(pubkey) && registration === undefined) return null;
  const session = getMarmotSession();
  if (!session || session.pubkey.toLowerCase() !== pubkey.toLowerCase()) return 0;
  const reg = registrationFor(pubkey);
  if (reg === undefined) return 0;
  session.pushRegistration.setRegistration(reg);
  return session.pushRegistration.pendingCount();
}

/**
 * An account is being removed from this device. If it ever had push on
 * (even if later turned off — a declined or unfinished retraction may have
 * left the token in its groups), its signer is already gone, so it can't
 * sign removals: delete the token at Apple/Google instead (on Android every
 * copy in that account's groups goes dead; iOS may hand the same APNs token
 * back later, so there revocation is best-effort — MIP-05 "Best-effort
 * revocation"). Only once the deletion succeeded (else it is retried at the
 * next start, before any token is handed out) is a fresh token fetched —
 * only if another account opted in — and the running account's groups
 * re-signed as part of this user action (a remote signer may prompt).
 * Returns false when the deletion has to be retried, or the account's
 * opt-in couldn't be forgotten.
 */
export function retireMarmotPushForAccount(pubkey: string): Promise<boolean> {
  return serial(async () => {
    // Unreadable settings: assume it was on — deleting a token is the safe side.
    const known = await ensureSettings().then(
      () => true,
      () => false,
    );
    const me = pubkey.toLowerCase();
    // Ever opted in — even if it later turned push off, a declined or
    // unfinished retraction may have left the token in its groups.
    const hadPush = !known || explicit.has(me) || settings.everEnabled.has(me);
    if (!hadPush) return true; // its groups never held the token
    // Forget its opt-in, so a later re-login starts with push off ('0' if
    // the key can't be removed).
    explicit.set(me, false);
    const forgotten = await AsyncStorage.removeItem(accountKey(pubkey)).then(
      () => true,
      () => tombstone(me),
    );
    setDeviceRegistration(undefined);
    if (!(await retireDeviceToken())) return false;
    const current = getMarmotSession();
    if (current && current.pubkey !== pubkey) await refreshAfterRetirement(current);
    else awaitingSession = { stale: current };
    return forgotten;
  });
}

/** The opt-in key couldn't be deleted: record the account in SecureStore
 * (honoured + retried at every hydration), and mark it off as well. */
async function tombstone(account: string): Promise<boolean> {
  const marked = await readForgotten()
    .then((list) => (list.includes(account) ? undefined : writeForgotten([...list, account])))
    .then(
      () => true,
      () => false,
    );
  const zeroed = await AsyncStorage.setItem(accountKey(account), '0').then(
    () => true,
    () => false,
  );
  return marked || zeroed;
}

/** Delete the token and fetch a new one for the accounts still on push —
 * their sessions re-publish it as they run (a remote signer waits for the
 * user). False when the deletion has to be retried (next start). */
async function rotateDeviceToken(): Promise<boolean> {
  setDeviceRegistration(undefined);
  if (!(await retireDeviceToken())) return false;
  try {
    setDeviceRegistration(await readRegistration(currentServer()));
    await registerWakeTask();
  } catch {
    // unknown, not "off" — the next start (or Finish setup) retries
  }
  return true;
}

async function refreshAfterRetirement(session: MarmotSession): Promise<void> {
  if (await retirementPending()) return;
  if (!anyEnabled()) {
    setDeviceRegistration(null); // nobody left on push: no new token at all
    return;
  }
  let next: DeviceRegistration;
  try {
    next = await readRegistration(currentServer());
  } catch {
    return; // unknown, not "off" — the next start retries
  }
  setDeviceRegistration(next);
  await registerWakeTask();
  // Other opted-in accounts get the new token when their sessions run.
  if (!isEnabled(session.pubkey)) return;
  session.pushRegistration.setRegistration(next);
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
  if (Platform.OS === 'android' && !anyEnabled()) {
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
  settings = { enabledAccounts: new Set(), everEnabled: new Set(), customServer: null };
  settingsLoaded = false;
  explicit.clear();
  hydrating = null;
  registration = undefined;
  awaitingSession = null;
  retiring = false;
  chain = Promise.resolve();
}
