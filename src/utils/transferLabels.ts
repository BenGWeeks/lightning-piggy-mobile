import * as nip19 from 'nostr-tools/nip19';
import type { WalletState, WalletMetadata } from '../types/wallet';

/** Dropdown label for a live wallet or another profile's stored metadata. */
export function formatTransferWalletLabel(
  w: WalletState | WalletMetadata,
  locale?: string,
): string {
  const balance = 'balance' in w ? w.balance : null;
  const balanceStr = balance !== null ? ` · ${balance.toLocaleString(locale)} sats` : '';
  const typeStr = w.walletType === 'onchain' ? 'on-chain' : 'lightning';
  return `${w.alias} (${typeStr})${balanceStr}`;
}

/** Profile label with an explicit marker for the active signing identity. */
export function formatTransferProfileLabel(
  pk: string,
  activePubkey: string | null,
  profileNameById: Record<string, string>,
): string {
  const cachedName = profileNameById[pk];
  if (pk === activePubkey) {
    // Mark the active profile so the user knows which row signs
    // the transfer; surface its actual name when we have it
    // cached so the dropdown reads e.g. "Big Piggy · default"
    // instead of an opaque "This profile (default)" that hides
    // who that is.
    return cachedName ? `${cachedName} · default` : 'This profile (default)';
  }
  if (cachedName) return cachedName;
  try {
    const npub = nip19.npubEncode(pk);
    return `${npub.slice(0, 14)}…${npub.slice(-6)}`;
  } catch {
    return `${pk.slice(0, 8)}…${pk.slice(-4)}`;
  }
}
