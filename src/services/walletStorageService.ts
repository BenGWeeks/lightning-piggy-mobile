import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { WalletMetadata } from '../types/wallet';

const WALLET_LIST_KEY = 'wallet_list';
const NWC_URL_PREFIX = 'nwc_url_';
const ONCHAIN_XPUB_PREFIX = 'onchain_xpub_';
const ELECTRUM_SERVER_KEY = 'electrum_server';
const LEGACY_NWC_KEY = 'nwc_connection_url';
const ONBOARDING_KEY = 'onboarding_complete';

/** Default Electrum server for on-chain balance/tx lookups (Blockstream, SSL) */
export const DEFAULT_ELECTRUM_SERVER = 'electrum.blockstream.info:50002:s';

export async function getWalletList(): Promise<WalletMetadata[]> {
  const json = await AsyncStorage.getItem(WALLET_LIST_KEY);
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export async function saveWalletList(wallets: WalletMetadata[]): Promise<void> {
  await AsyncStorage.setItem(WALLET_LIST_KEY, JSON.stringify(wallets));
}

// --- NWC ---

export async function saveNwcUrl(walletId: string, url: string): Promise<void> {
  await SecureStore.setItemAsync(`${NWC_URL_PREFIX}${walletId}`, url);
}

export async function getNwcUrl(walletId: string): Promise<string | null> {
  return SecureStore.getItemAsync(`${NWC_URL_PREFIX}${walletId}`);
}

export async function deleteNwcUrl(walletId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${NWC_URL_PREFIX}${walletId}`);
}

// --- On-chain (xpub) ---

export async function saveXpub(walletId: string, xpub: string): Promise<void> {
  await SecureStore.setItemAsync(`${ONCHAIN_XPUB_PREFIX}${walletId}`, xpub);
}

export async function getXpub(walletId: string): Promise<string | null> {
  return SecureStore.getItemAsync(`${ONCHAIN_XPUB_PREFIX}${walletId}`);
}

export async function deleteXpub(walletId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${ONCHAIN_XPUB_PREFIX}${walletId}`);
}

// --- Electrum / block-explorer server ---

export async function getElectrumServer(): Promise<string> {
  const saved = await AsyncStorage.getItem(ELECTRUM_SERVER_KEY);
  return saved || DEFAULT_ELECTRUM_SERVER;
}

export async function setElectrumServer(url: string): Promise<void> {
  await AsyncStorage.setItem(ELECTRUM_SERVER_KEY, url);
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
  // 1. Legacy single-wallet → multi-wallet migration
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
    }
    await SecureStore.deleteItemAsync(LEGACY_NWC_KEY);
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
}
