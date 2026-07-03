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
  // Set by slimDisplayProfile: records whether a lud16 was present before it
  // was stripped, so display surfaces can show/grey the zap affordance without
  // exposing the (unverified, forgeable) address value.
  hasLud16?: boolean;
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
