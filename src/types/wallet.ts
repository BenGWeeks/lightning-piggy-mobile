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
  /** Hide balance figures across the UI for this wallet (Account list + WalletCard). */
  hideBalance?: boolean;
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

/**
 * The "other party" of a NIP-57 zap transaction — the sender for an
 * incoming zap, the recipient for an outgoing one. Same shape for both
 * directions so the UI can render symmetrically with just a preposition
 * flip ("Received from …" vs "Sent to …").
 */
export interface ZapCounterpartyInfo {
  /** Counterparty's hex pubkey, or null if an anonymous incoming zap. */
  pubkey: string | null;
  /** Resolved kind-0 profile (null until fetched / not found). */
  profile: {
    npub: string;
    name: string | null;
    displayName: string | null;
    picture: string | null;
    nip05: string | null;
  } | null;
  /** Zap comment from the kind-9734 content field, if any. */
  comment: string;
  /** True when the zap request was marked anonymous (NIP-57 anon tag). */
  anonymous: boolean;
}

export interface WalletTransaction {
  type: TransactionType;
  amount: number;
  description?: string;
  created_at?: number | null;
  settled_at?: number | null;
  blockHeight?: number | null;
  /** Also set for Boltz claim txs, not just plain on-chain. */
  txid?: string;
  paymentHash?: string;
  preimage?: string;
  invoice?: string;
  /** Bolt11 invoice — needed to look up the paired zap receipt. */
  bolt11?: string;
  feesSats?: number;
  /** `undefined` = not yet resolved; `null` = tried and nothing found. */
  zapCounterparty?: ZapCounterpartyInfo | null;
  swapId?: string;
  swapType?: 'reverse' | 'submarine';
  claimTxId?: string;
  /**
   * Inserted client-side by SendSheet immediately after a successful
   * pay_invoice so the UI (ConversationScreen, TransactionList) can show
   * the send without waiting for LNbits to flush it into its ledger and
   * the next refresh to pick it up. Dropped on the next refresh when the
   * real tx arrives (matched by paymentHash).
   */
  optimistic?: boolean;
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
