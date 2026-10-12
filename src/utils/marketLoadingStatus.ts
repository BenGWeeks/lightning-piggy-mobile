import type { MarketMode } from './marketMode';

/** Full loading copy belongs only to an empty snapshot, including first-page loads. */
export function marketLoadingStatus(
  loading: boolean,
  _incomplete: boolean,
  count: number,
  mode: MarketMode,
) {
  if (loading) return count === 0 ? 'market.live.loading' : 'market.live.updating';
  return mode === 'preferred' ? 'market.live.loadedPreferred' : 'market.live.loaded';
}
