/** Full loading copy belongs only to an empty snapshot, including first-page loads. */
export function marketLoadingStatus(loading: boolean, incomplete: boolean, count: number) {
  if (loading && count === 0) return 'market.live.loading';
  if (incomplete) return 'market.live.incomplete';
  return 'market.live.loaded';
}
