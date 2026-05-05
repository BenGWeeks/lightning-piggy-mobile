import * as SecureStore from 'expo-secure-store';

/**
 * Multi-account identity registry.
 *
 * Lives in SecureStore (not AsyncStorage) because nsec values for
 * "nsec" identities are stored inline. Encrypted at rest by the OS
 * keychain on both Android (AndroidKeyStore + AES-256-GCM) and iOS.
 *
 * Storage shape — single JSON blob under one key so a switch is an
 * atomic read-modify-write:
 *
 *   {
 *     "identities": [
 *       { "pubkey": "abc...", "signerType": "nsec", "nsec": "nsec1...", "lastUsedAt": 1700000000000 },
 *       { "pubkey": "def...", "signerType": "amber", "lastUsedAt": 1700000001000 }
 *     ],
 *     "activePubkey": "abc..."
 *   }
 *
 * Keeps the existing single-identity SecureStore keys (`nostr_nsec`,
 * `nostr_pubkey`, `nostr_signer_type`) in lock-step with the active
 * identity — every other consumer in NostrContext reads those keys
 * directly, and we don't want to rewrite all of them. `switchIdentity`
 * mutates this JSON blob AND updates the legacy keys.
 */

const IDENTITIES_KEY = 'identities_v1';

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export type StoredSignerType = 'nsec' | 'amber';

export interface StoredIdentity {
  /** Hex pubkey (lowercase, 64 chars). */
  pubkey: string;
  /** Signer kind for this identity. */
  signerType: StoredSignerType;
  /**
   * Secret key in bech32 form. Present iff signerType === 'nsec'. Stored
   * inline so a switchIdentity flip is one round-trip rather than per-
   * identity SecureStore lookups.
   */
  nsec?: string;
  /** Epoch ms. Used to sort the switcher list newest-first. */
  lastUsedAt: number;
}

interface IdentitiesBlob {
  identities: StoredIdentity[];
  activePubkey: string | null;
}

const EMPTY_BLOB: IdentitiesBlob = { identities: [], activePubkey: null };

function isStoredIdentity(v: unknown): v is StoredIdentity {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(o.pubkey)) return false;
  if (o.signerType !== 'nsec' && o.signerType !== 'amber') return false;
  if (o.signerType === 'nsec' && typeof o.nsec !== 'string') return false;
  if (typeof o.lastUsedAt !== 'number' || !Number.isFinite(o.lastUsedAt)) return false;
  return true;
}

function parseBlob(raw: string | null): IdentitiesBlob {
  if (!raw) return EMPTY_BLOB;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_BLOB;
    const arr = Array.isArray(parsed.identities) ? parsed.identities : [];
    const identities = arr.filter(isStoredIdentity) as StoredIdentity[];
    const active =
      typeof parsed.activePubkey === 'string' &&
      identities.some((i) => i.pubkey === parsed.activePubkey)
        ? (parsed.activePubkey as string)
        : (identities[0]?.pubkey ?? null);
    return { identities, activePubkey: active };
  } catch {
    return EMPTY_BLOB;
  }
}

export async function loadIdentities(): Promise<IdentitiesBlob> {
  const raw = await SecureStore.getItemAsync(IDENTITIES_KEY);
  return parseBlob(raw);
}

async function saveIdentities(blob: IdentitiesBlob): Promise<void> {
  await SecureStore.setItemAsync(IDENTITIES_KEY, JSON.stringify(blob), SECURE_OPTIONS);
}

/**
 * Append `identity` to the registry (or update it in place if the
 * pubkey already exists), and mark it active. Returns the resulting
 * blob. Caller is responsible for syncing legacy keys via
 * `writeLegacyActiveKeys` if they're driving the active-identity state.
 */
export async function upsertIdentity(identity: StoredIdentity): Promise<IdentitiesBlob> {
  const blob = await loadIdentities();
  const idx = blob.identities.findIndex((i) => i.pubkey === identity.pubkey);
  const next: StoredIdentity = { ...identity, lastUsedAt: Date.now() };
  const list = [...blob.identities];
  if (idx === -1) list.push(next);
  else list[idx] = next;
  const out: IdentitiesBlob = { identities: list, activePubkey: identity.pubkey };
  await saveIdentities(out);
  return out;
}

/**
 * Remove `pubkey` from the registry. If it was active, the next
 * most-recently-used identity becomes active (or null if the list
 * empties). Returns the resulting blob.
 */
export async function removeIdentity(pubkey: string): Promise<IdentitiesBlob> {
  const blob = await loadIdentities();
  const list = blob.identities.filter((i) => i.pubkey !== pubkey);
  let active: string | null = blob.activePubkey;
  if (active === pubkey) {
    const sorted = [...list].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    active = sorted[0]?.pubkey ?? null;
  }
  const out: IdentitiesBlob = { identities: list, activePubkey: active };
  await saveIdentities(out);
  return out;
}

/**
 * Set `pubkey` as active and bump its lastUsedAt. Returns the
 * resulting blob. No-op if the pubkey isn't in the registry.
 */
export async function setActiveIdentity(pubkey: string): Promise<IdentitiesBlob> {
  const blob = await loadIdentities();
  const idx = blob.identities.findIndex((i) => i.pubkey === pubkey);
  if (idx === -1) return blob;
  const list = [...blob.identities];
  list[idx] = { ...list[idx], lastUsedAt: Date.now() };
  const out: IdentitiesBlob = { identities: list, activePubkey: pubkey };
  await saveIdentities(out);
  return out;
}

/**
 * Wipe the registry entirely. Used on full sign-out from every
 * account (the bottom-sheet has per-row sign-out for granular
 * removal — this is the nuclear option).
 */
export async function clearIdentities(): Promise<void> {
  await SecureStore.deleteItemAsync(IDENTITIES_KEY);
}
