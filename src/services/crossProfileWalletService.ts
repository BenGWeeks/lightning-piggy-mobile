// Read-only enumeration of OTHER profiles' wallet metadata, for the
// cross-profile Transfer flow (#485).
//
// `walletStorageService.getWalletList()` reads from `wallet_list_${pk}`
// where `pk` is the *active* pubkey held in module state. This helper
// is a sibling that takes an explicit pubkey argument so the Transfer
// sheet can list wallets owned by a non-active profile WITHOUT
// triggering an identity switch.
//
// Why a separate file rather than a parameter on getWalletList():
//   - getWalletList() is read AND written by everything that mutates
//     the active wallet list. Adding a parameter risks a caller
//     accidentally writing to another profile's slot.
//   - Cross-profile reads need to be intentional; making them go
//     through a different function name forces every call site to be
//     explicit about reading another identity's data.
//
// Per-account secrets (NWC URLs, xpubs, mnemonics) live in SecureStore
// keyed by walletId — globally unique per wallet, NOT scoped by
// pubkey. So `onchainService.getNextReceiveAddress(walletId)` can
// resolve any profile's on-chain wallet without further plumbing.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { WalletMetadata } from '../types/wallet';
import { perAccountKey } from './perAccountStorage';

const WALLET_LIST_KEY_BASE = 'wallet_list';

// Hex pubkey validation: lowercase 64-char hex, matches identitiesStore.
const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i;

/**
 * Read the wallet metadata list for `pubkey` directly from AsyncStorage.
 * Returns [] when the key is missing, malformed, or pubkey is invalid.
 *
 * Does NOT mutate any global state and does NOT change the active
 * profile. Safe to call alongside the active profile's getWalletList().
 */
export async function getWalletListForPubkey(
  pubkey: string | null | undefined,
): Promise<WalletMetadata[]> {
  if (!pubkey || !HEX_PUBKEY_RE.test(pubkey)) return [];
  const key = perAccountKey(WALLET_LIST_KEY_BASE, pubkey);
  const json = await AsyncStorage.getItem(key);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as WalletMetadata[]) : [];
  } catch {
    return [];
  }
}
