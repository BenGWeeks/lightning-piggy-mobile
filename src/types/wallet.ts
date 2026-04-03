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
  /** On-chain wallets: optional Electrum/API server override */
  electrumServer?: string;
}

export interface WalletState extends WalletMetadata {
  isConnected: boolean;
  balance: number | null;
  walletAlias: string | null; // alias from NWC getInfo()
}
