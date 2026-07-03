// One-shot migration helper for #547 — collapses the legacy Messages /
// Groups "Following only" boolean (plus the secretMode escape hatch) into
// the unified three-tier wotTier shared with the Map / Hunt / Events
// surfaces. Kept as a pure function so it's trivially unit-testable.
//
// Mapping rules:
//   followingOnly=true                       → 'friends'  (preserves explicit "filter on")
//   followingOnly=false && secretMode=true   → 'all'      (legacy dev escape hatch)
//   followingOnly=false && secretMode=false  → 'friends'  (production hard-lock — explicit off without secret mode stays safe)
//   followingOnly=null  (no legacy value)    → 'all'      (true first-run — matches wotSettingsService.DEFAULTS, #627 / PR #630)
//
// The `null` case used to map to 'friends' too, but that meant
// `GroupsContext`'s migration would *persist* 'friends' to storage on
// first login (overwriting `wotSettingsService.DEFAULTS = 'all'`) and
// reintroduce the empty Geo-caches / Events rail #627 was filed to fix.
// PR #630 Copilot review flagged this. Now the null path matches DEFAULTS
// so `wotSettingsService` stays the single source of truth for true
// first-run installs.

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
  // No legacy value to migrate from — defer to wotSettingsService.DEFAULTS.
  if (followingOnly === null) return 'all';
  // followingOnly === true OR (false && !secretMode) → 'friends'.
  return 'friends';
};
