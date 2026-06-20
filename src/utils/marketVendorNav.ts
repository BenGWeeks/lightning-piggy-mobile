// Navigation glue for Market vendor cards. Kept out of the screens so the
// (over-cap) ExploreHomeScreen and the MarketScreen can share one tested
// entry point instead of each duplicating the npub → ContactProfile dance.
//
// Not a pure util (it calls `navigation.navigate`), but it has no React and
// no relay I/O — it just decodes the baked-in npub and routes to the
// in-app contact profile (where Message / Zap live), so a vendor can be
// reached on Nostr without leaving the app.
import type { NavigationProp } from '@react-navigation/native';
import type { MarketVendor } from '../data/marketVendors';
import type { RootStackParamList } from '../navigation/types';
import { vendorNostrPubkey } from './marketVendors';

// Minimal nav surface this helper needs — any navigator able to reach the
// root-stack `ContactProfile` route satisfies it (the Market screens pass a
// CompositeNavigationProp).
type ContactProfileNavigator = Pick<NavigationProp<RootStackParamList>, 'navigate'>;

/**
 * Open the vendor's Nostr profile in-app so the user can message / zap them.
 * Returns `true` when navigation happened, `false` when the vendor has no
 * usable npub (the caller should fall back to opening the shop URL).
 */
export function openVendorNostrProfile(
  navigation: ContactProfileNavigator,
  vendor: MarketVendor,
): boolean {
  const pubkey = vendorNostrPubkey(vendor);
  if (!pubkey) return false;
  navigation.navigate('ContactProfile', {
    contact: {
      pubkey,
      name: vendor.name,
      // The vendor's kind-0 avatar isn't fetched at runtime; the directory's
      // baked logo is the best on-hand picture. ContactProfile re-resolves
      // the live kind-0 (name / picture / banner / lud16) once it mounts.
      picture: vendor.logo || null,
      lightningAddress: null,
      source: 'nostr',
    },
  });
  return true;
}
