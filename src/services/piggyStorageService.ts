import * as SecureStore from 'expo-secure-store';

/**
 * Local registry of LNURL-withdraw "Piggies" the user has hidden. Stored
 * in SecureStore because the LNURL string is a bearer token: anyone who
 * gets it can claim until the issuer-side cap is hit. Keeping it out of
 * AsyncStorage limits exposure to other apps + adb pulls on rooted dev
 * devices.
 *
 * Used by the Hunt feature (#468). The user creates the LNURL-w in
 * their wallet of choice (LNbits, Alby, Mutiny, …) and pastes it here
 * — see project memory `No LNbits-specific APIs`.
 */

const STORAGE_KEY = 'hunt-piggies:v1';

export interface HiddenPiggy {
  id: string;
  /** The bech32-encoded LNURL string the user pasted (or scanned). */
  lnurlw: string;
  /** Hider-supplied note shown on the finder's celebration screen. */
  memo: string;
  createdAt: number;
  /** When true, the hider has opted into publishing this Piggy as a
   * kind-30408 Nostr event so strangers can find it via the Discover
   * tab. The publish itself happens in milestone 6; the flag is stored
   * here from the create flow. */
  isPublic: boolean;
  /** Snapshot of the LNURL-w endpoint's max-withdrawable (millisats) at
   * create time — purely informational; the live value is queried on
   * each finder claim. Optional because old / unreachable LNURLs may
   * have been resolved before but failed at re-validation. */
  maxWithdrawableMsat?: number;
}

export const loadPiggies = async (): Promise<HiddenPiggy[]> => {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPiggy);
  } catch {
    return [];
  }
};

const persist = async (next: HiddenPiggy[]): Promise<void> => {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next));
};

export const savePiggy = async (piggy: HiddenPiggy): Promise<HiddenPiggy[]> => {
  const list = await loadPiggies();
  // Replace by id if a record with the same id already exists, otherwise
  // prepend so the newest sits at the top of the user's list.
  const idx = list.findIndex((p) => p.id === piggy.id);
  const next = idx >= 0 ? list.map((p, i) => (i === idx ? piggy : p)) : [piggy, ...list];
  await persist(next);
  return next;
};

export const removePiggy = async (id: string): Promise<HiddenPiggy[]> => {
  const list = await loadPiggies();
  const next = list.filter((p) => p.id !== id);
  await persist(next);
  return next;
};

/**
 * Generate a short stable id for a fresh Piggy. We don't need
 * cryptographic uniqueness — the LNURL string itself is the bearer
 * token — so a millis + suffix is plenty.
 */
export const newPiggyId = (): string =>
  `piggy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const isValidPiggy = (v: unknown): v is HiddenPiggy => {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.lnurlw === 'string' &&
    typeof p.memo === 'string' &&
    typeof p.createdAt === 'number' &&
    typeof p.isPublic === 'boolean'
  );
};
