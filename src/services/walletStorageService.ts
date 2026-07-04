import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { WalletMetadata } from '../types/wallet';
import { perAccountKey } from './perAccountStorage';

// Per-account namespacing landed with multi-account switching (#288).
// Wallets are scoped to the active Nostr identity so signing into a
// second identity gets a fresh wallet list rather than inheriting the
// previous user's NWC connections. Pre-multi-account installs ran the
// `migrateToPerAccountStorage` helper at first launch which copied the
// global `wallet_list` into `wallet_list_${activePubkey}`.
//
// `_activePubkey` is mirrored from NostrContext via
// `setActivePubkeyForWalletStorage`. When null (rare race during cold
// boot before identity hydrates) we fall back to the bare global key
// so legacy single-account installs keep working until the migration
// completes.
let _activePubkey: string | null = null;

// Subscribers (typically WalletContext) get notified whenever the
// active pubkey changes so they can tear down + re-hydrate the wallet
// list against the new account's namespaced storage. Without this,
// switching identities leaves the previous identity's wallets visible
// in-memory until the next cold start (see #288 review).
type ActivePubkeyListener = (pk: string | null) => void;
const _activePubkeyListeners = new Set<ActivePubkeyListener>();

// Resolves on the first `setActivePubkeyForWalletStorage` call —
// regardless of whether the value is a hex pubkey or null. Used by
// WalletContext's startup to gate the initial `getWalletList()` until
// NostrContext has hydrated identity from SecureStore. Without this
// gate WalletContext could read `wallet_list` (no suffix) on cold
// start, missing the per-account `wallet_list_${pubkey}` and showing
// the wrong identity's wallets — that's the root cause of the
// wallet-leak symptom (#461 / Copilot review on #442).
let _firstSetResolve: (() => void) | null = null;
const _firstSetPromise = new Promise<void>((resolve) => {
  _firstSetResolve = resolve;
});

export function setActivePubkeyForWalletStorage(pk: string | null): void {
  if (_activePubkey === pk) {
    // Idempotent same-value call still counts as "Nostr has spoken" —
    // resolve the gate even if the value matches the bootstrap null.
    if (_firstSetResolve) {
      _firstSetResolve();
      _firstSetResolve = null;
    }
    return;
  }
  _activePubkey = pk;
  if (_firstSetResolve) {
    _firstSetResolve();
    _firstSetResolve = null;
  }
  for (const listener of _activePubkeyListeners) {
    try {
      listener(pk);
    } catch (e) {
      // Don't let one buggy subscriber break the others.
      if (__DEV__) console.warn('[walletStorage] listener threw:', e);
    }
  }
}

/**
 * Resolves once NostrContext has called `setActivePubkeyForWalletStorage`
 * at least once — i.e. the activePubkey has been hydrated (whether to a
 * hex pubkey for a signed-in identity or to null for a logged-out
 * install). Race-fixes the cold-start window where WalletProvider
 * mounts before NostrProvider and would otherwise read the wrong
 * AsyncStorage key.
 *
 * Safe-fallback timeout (default 2 s) means a wedged NostrContext
 * doesn't permanently block wallet UI — callers fall through to
 * whatever `_activePubkey` happens to be (still null) and hit the
 * legacy unsuffixed key, matching pre-#288 behaviour.
 */
export async function awaitActivePubkeyHydrated(timeoutMs = 2000): Promise<void> {
  if (_firstSetResolve === null) return;
  await Promise.race([
    _firstSetPromise,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export function subscribeActivePubkey(listener: ActivePubkeyListener): () => void {
  _activePubkeyListeners.add(listener);
  return () => {
    _activePubkeyListeners.delete(listener);
  };
}

export function getActivePubkey(): string | null {
  return _activePubkey;
}
const WALLET_LIST_KEY_BASE = 'wallet_list';
function walletListKey(): string {
  return perAccountKey(WALLET_LIST_KEY_BASE, _activePubkey);
}
const NWC_URL_PREFIX = 'nwc_url_';
const ONCHAIN_XPUB_PREFIX = 'onchain_xpub_';
const ELECTRUM_SERVER_KEY = 'electrum_server';
// Per-account: this points at a wallet id from `wallet_list`, which is
// itself namespaced per identity (see `walletListKey`). A global default
// would let one identity's choice clobber the other's, so mirror the
// same `perAccountKey(...)` scheme. New key (no shipped global value to
// migrate), so it's namespaced inline without a migration step.
const DEFAULT_ONCHAIN_WALLET_ID_KEY_BASE = 'default_onchain_wallet_id_v1';
function defaultOnchainWalletIdKey(): string {
  return perAccountKey(DEFAULT_ONCHAIN_WALLET_ID_KEY_BASE, _activePubkey);
}
const BLOSSOM_SERVER_KEY = 'blossom_server';
const LEGACY_NWC_KEY = 'nwc_connection_url';
const ONBOARDING_KEY = 'onboarding_complete';
const GLOBAL_LIGHTNING_ADDRESS_KEY = 'lightning_address';
// Bumped each time a new one-shot migration step is added to
// `migrateLegacy`. Stored as an integer; any step whose target version
// exceeds the persisted value runs once and then writes the new version.
const STORAGE_MIGRATION_VERSION_KEY = 'storage_migration_version';
const CURRENT_STORAGE_MIGRATION_VERSION = 1;

/** Default Electrum server for on-chain balance/tx lookups (Blockstream, SSL) */
export const DEFAULT_ELECTRUM_SERVER = 'electrum.blockstream.info:50002:s';

/** Default Blossom media server (BUD-01/BUD-02) for image uploads. */
export const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net';

/**
 * SecureStore options for credentials (mnemonics, xpubs, NWC URLs).
 * `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` ensures keychain items are never
 * included in iCloud backups, are only readable after the first unlock
 * following a reboot, and cannot be migrated to a new device. Safer
 * default than the bare SecureStore defaults.
 */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function getWalletList(): Promise<WalletMetadata[]> {
  const json = await AsyncStorage.getItem(walletListKey());
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export async function saveWalletList(wallets: WalletMetadata[]): Promise<void> {
  await AsyncStorage.setItem(walletListKey(), JSON.stringify(wallets));
}

// --- NWC ---

export async function saveNwcUrl(walletId: string, url: string): Promise<void> {
  await SecureStore.setItemAsync(`${NWC_URL_PREFIX}${walletId}`, url, SECURE_OPTIONS);
}

export async function getNwcUrl(walletId: string): Promise<string | null> {
  return SecureStore.getItemAsync(`${NWC_URL_PREFIX}${walletId}`);
}

export async function deleteNwcUrl(walletId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${NWC_URL_PREFIX}${walletId}`);
}

// --- On-chain (xpub) ---

export async function saveXpub(walletId: string, xpub: string): Promise<void> {
  await SecureStore.setItemAsync(`${ONCHAIN_XPUB_PREFIX}${walletId}`, xpub, SECURE_OPTIONS);
}

export async function getXpub(walletId: string): Promise<string | null> {
  return SecureStore.getItemAsync(`${ONCHAIN_XPUB_PREFIX}${walletId}`);
}

export async function deleteXpub(walletId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${ONCHAIN_XPUB_PREFIX}${walletId}`);
}

// --- CoinOS managed-wallet recovery info (#287) ---
//
// Username + password for the coinos.io account that backs an NWC
// wallet auto-provisioned via `coinosService`. Persisted to SecureStore
// so Wallet Settings → "View recovery info" can re-display the same
// sheet after the initial mandatory recovery-info acknowledgement;
// without this the user has no way to recover the account if the
// device is wiped.

const COINOS_RECOVERY_PREFIX = 'coinos_recovery_';

export interface CoinosRecoveryInfo {
  /** Full API base URL — includes the `/api` path suffix (e.g.
   *  `https://coinos.io/api`) since that's what `coinosService` posts
   *  against. May be a self-hosted URL the user pointed LP at. To
   *  render a host for a lud16 / sign-in URL, strip the `/api` —
   *  `hostFromBaseUrl` in coinosService handles this. */
  baseUrl: string;
  username: string;
  password: string;
  /** ISO-8601 timestamp captured when the wallet was provisioned. */
  createdAt: string;
}

export async function saveCoinosRecovery(
  walletId: string,
  info: CoinosRecoveryInfo,
): Promise<void> {
  await SecureStore.setItemAsync(
    `${COINOS_RECOVERY_PREFIX}${walletId}`,
    JSON.stringify(info),
    SECURE_OPTIONS,
  );
}

export async function getCoinosRecovery(walletId: string): Promise<CoinosRecoveryInfo | null> {
  const raw = await SecureStore.getItemAsync(`${COINOS_RECOVERY_PREFIX}${walletId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CoinosRecoveryInfo>;
    if (!parsed.baseUrl || !parsed.username || !parsed.password) return null;
    return {
      baseUrl: parsed.baseUrl,
      username: parsed.username,
      password: parsed.password,
      createdAt: parsed.createdAt ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function deleteCoinosRecovery(walletId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${COINOS_RECOVERY_PREFIX}${walletId}`);
}

// --- On-chain (mnemonic) ---

const ONCHAIN_MNEMONIC_PREFIX = 'onchain_mnemonic_';

export async function saveMnemonic(walletId: string, mnemonic: string): Promise<void> {
  await SecureStore.setItemAsync(`${ONCHAIN_MNEMONIC_PREFIX}${walletId}`, mnemonic, SECURE_OPTIONS);
}

export async function getMnemonic(walletId: string): Promise<string | null> {
  return SecureStore.getItemAsync(`${ONCHAIN_MNEMONIC_PREFIX}${walletId}`);
}

export async function deleteMnemonic(walletId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${ONCHAIN_MNEMONIC_PREFIX}${walletId}`);
}

// --- Electrum / block-explorer server ---

export async function getElectrumServer(): Promise<string> {
  const saved = await AsyncStorage.getItem(ELECTRUM_SERVER_KEY);
  return saved || DEFAULT_ELECTRUM_SERVER;
}

export async function setElectrumServer(url: string): Promise<void> {
  await AsyncStorage.setItem(ELECTRUM_SERVER_KEY, url);
}

// --- Default on-chain wallet (for Boltz refunds + future on-chain destinations) ---

export async function getDefaultOnchainWalletId(): Promise<string | null> {
  return AsyncStorage.getItem(defaultOnchainWalletIdKey());
}

export async function setDefaultOnchainWalletId(walletId: string | null): Promise<void> {
  if (walletId === null) {
    await AsyncStorage.removeItem(defaultOnchainWalletIdKey());
  } else {
    await AsyncStorage.setItem(defaultOnchainWalletIdKey(), walletId);
  }
}

// --- Blossom media server ---

export async function getBlossomServer(): Promise<string> {
  const saved = await AsyncStorage.getItem(BLOSSOM_SERVER_KEY);
  return (saved && saved.trim()) || DEFAULT_BLOSSOM_SERVER;
}

export async function setBlossomServer(url: string): Promise<void> {
  await AsyncStorage.setItem(BLOSSOM_SERVER_KEY, url);
}

// --- Onboarding ---

export async function isOnboarded(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ONBOARDING_KEY);
  return value === 'true';
}

export async function setOnboarded(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
}

// --- Utilities ---

export function generateWalletId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Migrate legacy single-wallet storage to multi-wallet format.
 * Also backfills `walletType` for wallets created before on-chain support.
 * Idempotent — safe to call on every startup.
 */
export async function migrateLegacy(): Promise<void> {
  // 1. Legacy single-wallet → multi-wallet migration.
  // Order: write the new wallet list + persist the NWC URL first, then delete
  // the legacy key. If a crash interrupts the migration, the legacy key is
  // still present and the next startup retries from scratch. Deleting first
  // could permanently lose the user's NWC URL on a partial write.
  const legacyUrl = await SecureStore.getItemAsync(LEGACY_NWC_KEY);
  if (legacyUrl) {
    const existingList = await getWalletList();
    if (existingList.length === 0) {
      const id = generateWalletId();
      const wallet: WalletMetadata = {
        id,
        alias: 'My Wallet',
        theme: 'lightning-piggy',
        order: 0,
        walletType: 'nwc',
        lightningAddress: null,
      };
      await saveNwcUrl(id, legacyUrl);
      await saveWalletList([wallet]);
      await setOnboarded();
      // Only after the new records are durably written do we drop the
      // legacy key. If this delete fails, next startup sees existingList
      // non-empty and skips re-migration — we just clean up the orphan key.
      await SecureStore.deleteItemAsync(LEGACY_NWC_KEY);
    } else {
      // List is already populated — legacy key is a stale leftover. Safe
      // to delete: its data has already been migrated (or the user added
      // new wallets after). Not deleting would mean migrateLegacy re-reads
      // it forever but never acts on it; cleaning up is better.
      await SecureStore.deleteItemAsync(LEGACY_NWC_KEY);
    }
  }

  // 2. Backfill walletType for wallets that predate on-chain support
  const wallets = await getWalletList();
  let needsSave = false;
  const updated = wallets.map((w) => {
    if (!w.walletType) {
      needsSave = true;
      return { ...w, walletType: 'nwc' as const };
    }
    return w;
  });
  if (needsSave) {
    await saveWalletList(updated);
  }

  // 3. Versioned migrations. See #169 for the original driver.
  const persistedVersionRaw = await AsyncStorage.getItem(STORAGE_MIGRATION_VERSION_KEY);
  const persistedVersion = persistedVersionRaw ? parseInt(persistedVersionRaw, 10) || 0 : 0;

  // Each step sets this to `false` when it needs to defer (e.g. waiting
  // for prerequisite state to exist) so we don't advance the version
  // past work that hasn't run yet. Next cold start re-evaluates.
  let canAdvance = true;

  if (persistedVersion < 1) {
    // v1: Lightning Address moves from a single global field into each
    // wallet's metadata (#169). Copy the global value into any wallet
    // that doesn't already have its own address, preserving wallet-
    // specific addresses parsed from NWC `lud16=` query strings, then
    // remove the global storage key — nothing reads it anymore.
    const globalAddress = await AsyncStorage.getItem(GLOBAL_LIGHTNING_ADDRESS_KEY);
    if (globalAddress) {
      const list = await getWalletList();
      if (list.length === 0) {
        // Defer: older builds let users set a lightning address before
        // adding any wallet. Dropping the key now would throw that
        // value away before a wallet exists to own it — retry next
        // startup (and leave `storage_migration_version` at 0 so we
        // re-run). Nothing else in the codebase reads the legacy key,
        // so leaving it in place is harmless.
        canAdvance = false;
      } else {
        const backfilled = list.map((w) =>
          w.lightningAddress ? w : { ...w, lightningAddress: globalAddress },
        );
        const anyChange = backfilled.some(
          (w, i) => w.lightningAddress !== list[i].lightningAddress,
        );
        if (anyChange) await saveWalletList(backfilled);
        await AsyncStorage.removeItem(GLOBAL_LIGHTNING_ADDRESS_KEY);
      }
    }
  }

  if (canAdvance && persistedVersion < CURRENT_STORAGE_MIGRATION_VERSION) {
    await AsyncStorage.setItem(
      STORAGE_MIGRATION_VERSION_KEY,
      String(CURRENT_STORAGE_MIGRATION_VERSION),
    );
  }
}
