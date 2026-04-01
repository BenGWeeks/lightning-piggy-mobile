export interface NostrProfile {
  pubkey: string; // hex
  npub: string; // bech32
  name: string | null;
  displayName: string | null;
  picture: string | null;
  banner: string | null;
  about: string | null;
  lud16: string | null; // lightning address
  nip05: string | null;
}

export interface NostrContact {
  pubkey: string; // hex
  relay: string | null;
  petname: string | null;
  profile: NostrProfile | null; // populated after fetching
}

export interface RelayConfig {
  url: string;
  read: boolean;
  write: boolean;
}

export type SignerType = 'nsec' | 'amber';
