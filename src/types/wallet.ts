export type CardTheme =
  | 'lightning-piggy'
  | 'lightning-bee'
  | 'lightning-cat'
  | 'lightning-cow'
  | 'lightning-goat'
  | 'nostrich'
  | 'lightning-whale'
  | 'bitcoin'
  | 'alby'
  | 'lnbits'
  | 'primal'
  | 'coinos';

export type WalletType = 'nwc' | 'onchain';

/** How an on-chain wallet was imported. Only 'xpub' is supported now;
 *  'mnemonic' and 'generated' are reserved for future hot-wallet support. */
export type OnchainImportMethod = 'xpub' | 'mnemonic' | 'generated';

export interface WalletMetadata {
  id: string;
  alias: string;
  theme: CardTheme;
  order: number;
  walletType: WalletType;
  /** NWC wallets only */
  lightningAddress: string | null;
  /** On-chain wallets only */
  onchainImportMethod?: OnchainImportMethod;
  /** On-chain wallets: reserved metadata field for a future per-wallet
   *  Electrum/API server override. Not currently consulted by
   *  `onchainService` — it reads the global `getElectrumServer()` only.
   *  Keep writing the field if the UI collects it, but don't rely on it
   *  having any effect today. */
  electrumServer?: string;
}

export type TransactionType = 'incoming' | 'outgoing';

export interface WalletTransaction {
  type: TransactionType;
  amount: number;
  description?: string;
  created_at?: number | null;
  settled_at?: number | null;
  blockHeight?: number | null;
  /** Boltz swap details (if this transaction was part of a swap) */
  swapId?: string;
  swapType?: 'reverse' | 'submarine';
  claimTxId?: string;
}

/** Format wallet name with type suffix for dropdowns */
export function walletLabel(w: { alias: string; walletType: WalletType }): string {
  return `${w.alias} (${w.walletType === 'onchain' ? 'on-chain' : 'lightning'})`;
}

export interface WalletState extends WalletMetadata {
  isConnected: boolean;
  balance: number | null;
  walletAlias: string | null; // alias from NWC getInfo()
  transactions: WalletTransaction[];
}
