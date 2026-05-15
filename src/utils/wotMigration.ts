// One-shot migration helper for #547 — collapses the legacy Messages /
// Groups "Following only" boolean (plus the secretMode escape hatch) into
// the unified three-tier wotTier shared with the Map / Hunt / Events
// surfaces. Kept as a pure function so it's trivially unit-testable.
//
// Mapping rules (per the issue's "AsyncStorage migration" acceptance):
//   followingOnly=true                       → 'friends'  (current default)
//   followingOnly=false && secretMode=true   → 'all'      (existing dev escape hatch)
//   anything else (incl. null / undefined)   → 'friends'  (safe default)

import type { WotTier } from '../services/wotSettingsService';

export interface LegacyMessagesFilterState {
  followingOnly: boolean | null;
  secretMode: boolean;
}

export const deriveInitialWotTier = ({
  followingOnly,
  secretMode,
}: LegacyMessagesFilterState): WotTier => {
  if (followingOnly === false && secretMode) return 'all';
  // followingOnly === true OR null/missing OR secretMode=false → 'friends'.
  return 'friends';
};
