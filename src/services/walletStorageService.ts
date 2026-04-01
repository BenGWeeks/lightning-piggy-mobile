import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { WalletMetadata } from '../types/wallet';

const WALLET_LIST_KEY = 'wallet_list';
const NWC_URL_PREFIX = 'nwc_url_';
const LEGACY_NWC_KEY = 'nwc_connection_url';
const ONBOARDING_KEY = 'onboarding_complete';

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

export async function saveNwcUrl(walletId: string, url: string): Promise<void> {
  await SecureStore.setItemAsync(`${NWC_URL_PREFIX}${walletId}`, url);
}

export async function getNwcUrl(walletId: string): Promise<string | null> {
  return SecureStore.getItemAsync(`${NWC_URL_PREFIX}${walletId}`);
}

export async function deleteNwcUrl(walletId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${NWC_URL_PREFIX}${walletId}`);
}

export async function isOnboarded(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ONBOARDING_KEY);
  return value === 'true';
}

export async function setOnboarded(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
}

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
 * Idempotent — no-op if already migrated or no legacy data exists.
 */
export async function migrateLegacy(): Promise<void> {
  const legacyUrl = await SecureStore.getItemAsync(LEGACY_NWC_KEY);
  if (!legacyUrl) return;

  const existingList = await getWalletList();
  if (existingList.length > 0) {
    // Already migrated, just clean up legacy key
    await SecureStore.deleteItemAsync(LEGACY_NWC_KEY);
    return;
  }

  const id = generateWalletId();
  const wallet: WalletMetadata = {
    id,
    alias: 'My Wallet',
    theme: 'lightning-piggy',
    order: 0,
    lightningAddress: null,
  };

  await saveNwcUrl(id, legacyUrl);
  await saveWalletList([wallet]);
  await SecureStore.deleteItemAsync(LEGACY_NWC_KEY);
  await setOnboarded();
}
