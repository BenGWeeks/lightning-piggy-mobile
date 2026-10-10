// The app's notification-watcher registrar: wires WatcherPushRegistrar to the
// real token (shared with Marmot push — see marmotPushRegistration.ts), the
// user's signer, NWC storage and the relays. Started by WatcherPushBridge;
// read and driven by the Settings → Security push section.

import * as Application from 'expo-application';
import type { NostrEvent } from 'nostr-tools/pure';

import type { SignerType } from '../types/nostr';
import { createMarmotSigner } from './marmotSigner';
import { currentPushDevice, subscribePushDevice } from './marmotPushRegistration';
import { getNwcUrl } from './walletStorageService';
import { loadWatcherState, saveWatcherState } from './watcherPushStore';
import { publishToWatcher } from './watcherPushTransport';
import {
  WatcherPushRegistrar,
  type WatcherContext,
  type WatcherStatus,
  type WatcherSyncOutcome,
} from './watcherPushRegistrar';
import type { SealSigner, WatcherCategories, WatcherCategory } from './watcherRegistration';

/** The app's signer backends (nsec / Amber / NIP-46), as a seal signer. */
function sealSigner(pubkey: string, signerType: SignerType, cancelled: () => boolean): SealSigner {
  const signer = createMarmotSigner(pubkey, signerType, { cancelled });
  return {
    pubkey,
    nip44Encrypt: async (peer, plaintext) => {
      if (!signer.nip44) throw new Error('watcher: signer has no NIP-44');
      return signer.nip44.encrypt(peer, plaintext);
    },
    signEvent: async (template) => (await signer.signEvent(template)) as NostrEvent,
  };
}

/** The APNs environment this build's token belongs to ('development' = sandbox). */
async function apnsEnv(): Promise<'production' | 'sandbox' | undefined> {
  try {
    const env = await Application.getIosPushNotificationServiceEnvironmentAsync();
    if (env === 'development') return 'sandbox';
    return env === 'production' ? 'production' : undefined;
  } catch {
    return undefined;
  }
}

const registrar: WatcherPushRegistrar = new WatcherPushRegistrar({
  // Only the token of the account being registered — and only if that
  // account turned push on itself (accounts on one phone stay unlinkable).
  device: () => currentPushDevice(registrar.activePubkey()),
  appId: () => Application.applicationId,
  apnsEnv,
  nwcUrl: getNwcUrl,
  signer: sealSigner,
  publish: publishToWatcher,
  load: loadWatcherState,
  save: saveWatcherState,
  now: Date.now,
});

let started = false;

/** Once, at app start (staggered by the bridge): follow the push token. */
export function startWatcherPush(): () => void {
  if (started) return () => undefined;
  started = true;
  const unsubscribe = subscribePushDevice(() => registrar.onDeviceChanged());
  registrar.onDeviceChanged();
  return () => {
    unsubscribe();
    started = false;
  };
}

export const setWatcherContext = (ctx: WatcherContext | null): void => registrar.setContext(ctx);
export const getWatcherCategories = (): Promise<WatcherCategories | null> => registrar.categories();
export const setWatcherCategory = (
  category: WatcherCategory,
  on: boolean,
): Promise<WatcherCategories | null> => registrar.setCategory(category, on);
export const syncWatcherNow = (): Promise<WatcherSyncOutcome> => registrar.syncNow();

const UNREGISTER_TIMEOUT_MS = 20_000;

/**
 * Tell the watcher to drop this phone — before Marmot push deletes the token
 * (push switched off) or the account's key is wiped (sign-out). Bounded: a
 * remote signer that never answers (an offline NIP-46 bunker) can't hold up
 * the switch or the sign-out, and once given up the request is abandoned so
 * it can't prompt later. False if it didn't go through; the token deletion
 * that follows still ends Android pushes.
 */
export function unregisterWatcherPush(): Promise<boolean> {
  let gaveUp = false;
  return Promise.race([
    registrar.unregisterNow(() => gaveUp).catch(() => false),
    new Promise<boolean>((resolve) =>
      setTimeout(() => {
        gaveUp = true;
        resolve(false);
      }, UNREGISTER_TIMEOUT_MS),
    ),
  ]);
}

/** Signing out of `pubkey`: only the ACTIVE account can still sign here —
 * another account's removal relies on the token deletion. */
export async function unregisterWatcherBeforeSignOut(pubkey: string): Promise<boolean> {
  if (registrar.activePubkey() !== pubkey) return false;
  return unregisterWatcherPush();
}

export const getWatcherStatus = (): WatcherStatus => registrar.getStatus();
export const subscribeWatcherStatus = (listener: () => void): (() => void) =>
  registrar.subscribe(listener);
