/**
 * Geo-cache (NIP-GC kind-37516) relay set. Distinct from
 * `DEFAULT_RELAYS` (wallet / social / DM traffic, in `nostrService.ts`)
 * because a relay-by-relay audit of published treasures (#907) showed only
 * a subset of the generic defaults actually retain kind-37516, and the
 * companion treasures.to web app reads + runs NIP-50 search against two
 * relays that aren't in the generic set at all:
 *
 *   - nos.lol            backbone — stored 11/11 audited treasures
 *   - relay.damus.io     backbone — stored 10/11
 *   - relay.ditto.pub    treasures.to read + NIP-50 search relay
 *   - relay.dreamith.to  treasures.to read + NIP-50 search relay
 *
 * Deliberately drops `relay.nostr.band` and `relay.primal.net`: both
 * silently drop kind-37516 (primal is a social-kind caching service; the
 * write appears to succeed but nothing is stored). Writes to the Ditto
 * relays are unauthenticated for normal public events (NIP-42 is only
 * required for NIP-70 protected events tagged `-`), so adding them is a
 * plain relay addition, not an auth integration.
 *
 * The NIP-GC publish/read helpers in `nostrPlacesPublisher.ts` union this
 * set into whatever relays the caller passes, so mobile-created treasures
 * always land on (and are read from) exactly the relays treasures.to uses.
 *
 * Lives in its own module (not appended to the over-cap `nostrService.ts`)
 * per the CLAUDE.md file-size rule.
 */
export const GC_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to',
];
