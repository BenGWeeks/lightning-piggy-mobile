import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { BOLTZ_API, fetchWithTimeout } from './boltzApi';

export const DEFAULT_SWAP_BACKEND = BOLTZ_API;
const SETTING_KEY = 'swap_backend_url_v1';

/** Accept an HTTPS origin or API base, including reverse-proxy path prefixes. */
export function normalizeSwapBackend(input: string): string {
  const value = input.trim();
  if (!/^https:\/\//i.test(value) || /[\\\s?#]/.test(value)) {
    throw new Error('Enter an HTTPS server URL without a query or fragment.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid HTTPS server URL.');
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error('The server URL must not contain credentials.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/(v\d+|ws)$/.test(path) && !path.endsWith('/v2')) {
    throw new Error('Enter the server URL or its v2 API base.');
  }
  return `${url.origin}${path.endsWith('/v2') ? path : `${path}/v2`}`;
}

/** Storage failures must not silently switch a private user back to a public server. */
export async function getSwapBackend(): Promise<string> {
  const saved = await AsyncStorage.getItem(SETTING_KEY);
  return saved === null ? DEFAULT_SWAP_BACKEND : normalizeSwapBackend(saved);
}

/** Check both supported BTC swap directions without creating a swap. */
export async function checkAndSaveSwapBackend(input: string): Promise<string> {
  const backend = normalizeSwapBackend(input);
  await Promise.all(
    ['reverse', 'submarine'].map(async (direction) => {
      const response = await fetchWithTimeout(`${backend}/swap/${direction}`);
      if (!response.ok) throw new Error(`Swap server check failed (HTTP ${response.status}).`);
      const pairs = await response.json();
      const pair = pairs?.BTC?.BTC;
      if (
        !pair ||
        !Number.isFinite(pair.limits?.minimal) ||
        !Number.isFinite(pair.limits?.maximal) ||
        pair.limits.minimal < 0 ||
        pair.limits.maximal < pair.limits.minimal ||
        !Number.isFinite(pair.fees?.percentage) ||
        pair.fees.percentage < 0
      ) {
        throw new Error('The server must support Boltz v2 Bitcoin/Lightning swaps.');
      }
    }),
  );
  await AsyncStorage.setItem(SETTING_KEY, backend);
  return backend;
}

function backendKey(swapId: string): string {
  if (typeof swapId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(swapId))
    throw new Error('Invalid swap ID.');
  return `boltz_backend_${swapId}`;
}

// Retain these small records after completion so transaction history can still
// query its original provider. Never consult the current setting for an old ID.
export async function getSwapBackendForId(swapId: string): Promise<string> {
  const saved = await SecureStore.getItemAsync(backendKey(swapId));
  return saved === null || saved === undefined ? DEFAULT_SWAP_BACKEND : normalizeSwapBackend(saved);
}

let pinQueue: Promise<void> = Promise.resolve();
/** Persist before returning a newly created swap to any caller that can fund it. */
export function pinSwapBackend(swapId: string, backend: string): Promise<void> {
  const operation = pinQueue
    .catch(() => undefined)
    .then(async () => {
      const key = backendKey(swapId);
      const normalized = normalizeSwapBackend(backend);
      const [existing, reverse, submarine] = await Promise.all([
        SecureStore.getItemAsync(key),
        SecureStore.getItemAsync(`boltz_swap_${swapId}`),
        SecureStore.getItemAsync(`submarine_swap_${swapId}`),
      ]);
      // Refuse reused IDs before a caller can overwrite another swap's secrets.
      if (existing || reverse || submarine)
        throw new Error('Swap server returned a reused swap ID.');
      await SecureStore.setItemAsync(key, normalized, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    });
  pinQueue = operation;
  return operation;
}

export function swapWebSocketUrl(backend: string): string {
  return `${normalizeSwapBackend(backend).replace(/^https:/, 'wss:')}/ws`;
}
