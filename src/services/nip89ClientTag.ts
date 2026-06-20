// NIP-89 client tag stamped onto the PUBLIC events Lightning Piggy publishes,
// so that anything LP signs is attributable to the app and filterable by
// client. See https://github.com/nostr-protocol/nips/blob/master/89.md
//
// NIP-89's first `client` argument is a human-readable application name (the
// same string a 31990 application-handler advertises as its display name),
// which is why this is "Lightning Piggy" and not a reverse-DNS app id. Real
// clients follow the same convention (e.g. Damus tags "Damus", Primal tags
// "Primal"). Reverse-DNS ids are an Android `applicationId` convention, not a
// Nostr client-tag one.
//
// Bare two-element form for now. Once an LP application-handler event
// (kind 31990) is published, this can be upgraded to the full
// ['client', name, '31990:<pubkey>:<d>', '<relay-hint>'] coordinate so a
// reader can resolve the handler (name, icon, supported kinds) from the tag.
//
// Deliberately NOT added to the kind-14 DM / group-chat rumors: those are
// sealed into NIP-17 gift wraps, and a client tag inside the seal would leak
// client metadata. Public events only — spread a fresh copy at each use site
// (`[...LP_CLIENT_TAG]`) so no event aliases the shared array. Frozen so the
// shared template can't be mutated in place.
export const LP_CLIENT_TAG = Object.freeze(['client', 'Lightning Piggy']) as readonly [
  'client',
  'Lightning Piggy',
];
