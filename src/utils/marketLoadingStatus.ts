/** Full loading copy belongs only to an empty snapshot, including first-page loads. */
export function marketLoadingStatus(loading: boolean, incomplete: boolean, count: number) {
  if (loading) return count === 0 ? 'market.live.loading' : 'market.live.updating';
  if (incomplete) return 'market.live.incomplete';
  return 'market.live.loaded';
}
