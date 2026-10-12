/** Full loading copy belongs only to an empty snapshot, including first-page loads. */
export function marketLoadingStatus(loading: boolean, _incomplete: boolean, count: number) {
  if (loading) return count === 0 ? 'market.live.loading' : 'market.live.updating';
  return 'market.live.loaded';
}
