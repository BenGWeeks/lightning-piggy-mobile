import { InteractionManager } from 'react-native';
import type { StoredIdentity } from '../services/identitiesStore';
import type { NostrProfile, NostrContact } from '../types/nostr';
import { persistActiveIdentityKeys } from './persistActiveIdentityKeys';

// Side-effect bundle the logout-with-successor flow drives. Kept as an
// explicit deps object (rather than reaching into the provider) so the
// promotion is a single, testable unit and NostrContext stays a thin caller.
export interface PromoteSuccessorDeps {
  setProfile: (p: NostrProfile | null) => void;
  setContacts: (c: NostrContact[]) => void;
  setPubkey: (pk: string) => void;
  setSignerType: (s: StoredIdentity['signerType']) => void;
  setIsLoggedIn: (v: boolean) => void;
  // Cache loaders — return value (boolean cache-hit / void) is ignored here.
  loadProfileFromCache: (pk: string) => Promise<unknown>;
  loadContactsFromCache: (pk: string) => Promise<unknown>;
  hydrateDmInboxFromCache: (pk: string) => Promise<unknown>;
  loadRelays: (pk: string) => Promise<string[]>;
  loadProfile: (pk: string, relays: string[]) => Promise<void>;
}

// Promote `successor` to the active identity after the previous one signed
// out, WITHOUT dropping the user to the logged-out screen (#288) — they sign
// out of Big Piggy and land straight on the successor.
//
// Order matters for #851 F4 (stale drawer): clear the signed-out identity's
// profile + contacts BEFORE promoting so the drawer header never renders the
// old display name against the new active session, then hydrate the
// successor's own cached profile so the header repaints to the successor
// immediately instead of staying blank until the deferred relay round-trip.
// Mirrors switchIdentity's teardown/hydrate sequencing.
export async function promoteSuccessorIdentity(
  successor: StoredIdentity,
  deps: PromoteSuccessorDeps,
): Promise<void> {
  await persistActiveIdentityKeys(successor);
  deps.setProfile(null);
  deps.setContacts([]);
  deps.setPubkey(successor.pubkey);
  deps.setSignerType(successor.signerType);
  deps.setIsLoggedIn(true);
  await deps.loadProfileFromCache(successor.pubkey);
  await deps.loadContactsFromCache(successor.pubkey);
  await deps.hydrateDmInboxFromCache(successor.pubkey);
  // Defer the relay refresh so a successor with no cached profile still
  // converges to its real kind-0 (mirrors switchIdentity).
  InteractionManager.runAfterInteractions(async () => {
    try {
      const readRelays = await deps.loadRelays(successor.pubkey);
      await deps.loadProfile(successor.pubkey, readRelays);
    } catch (e) {
      if (__DEV__) console.warn('[Nostr] post-logout successor refresh failed:', e);
    }
  });
}
