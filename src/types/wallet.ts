export type CardTheme = 'lightning-piggy' | 'primal' | 'lnbits' | 'nostrich' | 'generic';

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
