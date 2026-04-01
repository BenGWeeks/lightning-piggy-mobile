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

export interface WalletMetadata {
  id: string;
  alias: string;
  theme: CardTheme;
  order: number;
  lightningAddress: string | null;
}

export interface WalletState extends WalletMetadata {
  isConnected: boolean;
  balance: number | null;
  walletAlias: string | null; // alias from NWC getInfo()
}
