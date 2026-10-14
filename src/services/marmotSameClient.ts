// What "the same client" means to MLS in a Marmot group (#1559).
//
// RFC 9420 forbids adding a KeyPackage that represents the same client as an
// existing member, and leaves "same client" to the application. The ts-mls
// vendored in marmot-ts treats a matching signature key OR a matching
// credential as the same client — but every Marmot credential is just the
// account's Nostr pubkey, so that rule makes each ACCOUNT a single client: a
// device installed after the account joined could never be added, and a
// commit from another client that adds one (MDK's "invite all fresh
// devices") would be rejected here as invalid, dropping us out of the group.
//
// Marmot multi-device is one leaf per INSTALL, and every current client
// keeps one leaf signing key per install (Lightning Piggy #1492, MDK since
// v0.10) — so here the same client means the same leaf signature key, which
// is also how MDK spots a device already in the group. Applied for creating
// and processing commits alike, like the crypto provider (installed the same
// way: the library reads its shared default config at call time).
//
// Upstream: marmot-ts should expose this as client config; until then the
// default is adjusted in place, once.

import { defaultKeyPackageEqualityConfig } from '@internet-privacy/marmot-ts/mls';

type Config = typeof defaultKeyPackageEqualityConfig;
type KeyPackage = Parameters<Config['compareKeyPackageToLeafNode']>[0];
type LeafNode = Parameters<Config['compareKeyPackageToLeafNode']>[1];

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/** Same client ⇔ same leaf signature key (not merely the same account). */
export function isSameMarmotClient(keyPackage: KeyPackage, leaf: LeafNode): boolean {
  return sameBytes(keyPackage.leafNode.signaturePublicKey, leaf.signaturePublicKey);
}

export function installMarmotSameClientRule(): void {
  (defaultKeyPackageEqualityConfig as Config).compareKeyPackageToLeafNode = isSameMarmotClient;
}
