// A person's DEVICES in a Marmot chat (#1267), read straight from the group's
// MLS ratchet tree. Pure: no session, no storage, no relays.
//
// Every install the person was invited on is its own MLS leaf. Leaves are
// grouped into people by their credential (the Nostr pubkey), and told apart
// by their leaf signature key — stable for the leaf's lifetime (an Update
// re-signs the leaf but keeps the key), and the same key the device's
// kind-30443 invitation key (KeyPackage) carried, so it links a leaf back to
// the invitation key it joined with.
//
// Everything here is standard Marmot / MLS data any client publishes:
//   - the credential identity (Marmot: the Nostr pubkey);
//   - the leaf signature key;
//   - the `0x8009` account identity proof every Marmot leaf carries, whose
//     `created_at` is when that device made the invitation key it joined with.
// No Lightning Piggy-only fields.

import {
  ACCOUNT_IDENTITY_PROOF_COMPONENT_ID,
  decodeAuthorizationProof,
  getComponentData,
  getCredentialPubkey,
  getKeyPackage,
} from '@internet-privacy/marmot-ts';
import {
  defaultCredentialTypes,
  nodeTypes,
  type ClientState,
  type GroupContextExtension,
  type LeafNode,
} from '@internet-privacy/marmot-ts/mls';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Event as NostrEvent } from 'nostr-tools';

/** One device (MLS leaf) in a group. */
export interface GroupLeaf {
  /** The account it belongs to (lower-case hex). */
  pubkey: string;
  /** Its MLS leaf index. */
  leafIndex: number;
  /** Its leaf signature key (hex) — the device's identity within the group. */
  key: string;
  /** When the device made the invitation key it joined with (unix seconds),
   * from the leaf's account identity proof; null if the leaf has none. */
  keyCreatedAt: number | null;
  /** This is our own leaf: the device we're running on. */
  isOwn: boolean;
}

/** The leaf's account-identity-proof timestamp, or null (none / undecodable). */
export function leafKeyCreatedAt(leaf: Pick<LeafNode, 'extensions'>): number | null {
  try {
    const data = getComponentData(
      leaf.extensions as unknown as GroupContextExtension[],
      ACCOUNT_IDENTITY_PROOF_COMPONENT_ID,
    );
    return data ? decodeAuthorizationProof(data).createdAt : null;
  } catch {
    return null;
  }
}

/**
 * Every member leaf of the tree, in leaf order. Blank slots, non-basic
 * credentials and leaves whose identity isn't a valid Nostr pubkey are
 * skipped (the same rule marmot-ts's `getGroupMembers` applies), so the
 * people here always match the chat's member list.
 */
export function readGroupLeaves(
  state: Pick<ClientState, 'ratchetTree'> & { privatePath?: { leafIndex: number } },
): GroupLeaf[] {
  const ownLeaf = state.privatePath?.leafIndex;
  const leaves: GroupLeaf[] = [];
  state.ratchetTree.forEach((node, nodeIndex) => {
    // Leaves sit at even node indexes; leaf index = node index / 2.
    if (!node || node.nodeType !== nodeTypes.leaf) return;
    const leaf = node.leaf;
    if (leaf.credential.credentialType !== defaultCredentialTypes.basic) return;
    let pubkey: string;
    try {
      pubkey = getCredentialPubkey(leaf.credential).toLowerCase();
    } catch {
      return;
    }
    const leafIndex = Math.floor(nodeIndex / 2);
    leaves.push({
      pubkey,
      leafIndex,
      key: bytesToHex(leaf.signaturePublicKey),
      keyCreatedAt: leafKeyCreatedAt(leaf),
      isOwn: leafIndex === ownLeaf,
    });
  });
  return leaves;
}

/** Leaves grouped by person, each person's in leaf order. */
export function leavesByPerson(leaves: readonly GroupLeaf[]): Map<string, GroupLeaf[]> {
  const out = new Map<string, GroupLeaf[]>();
  for (const leaf of leaves) {
    const list = out.get(leaf.pubkey);
    if (list) list.push(leaf);
    else out.set(leaf.pubkey, [leaf]);
  }
  return out;
}

/** How many devices each person has in the chat. */
export function deviceCounts(leaves: readonly GroupLeaf[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const leaf of leaves) out.set(leaf.pubkey, (out.get(leaf.pubkey) ?? 0) + 1);
  return out;
}

/** The leaf signature key (hex) a kind-30443 invitation key carries, or null. */
export function keyPackageSignatureKey(event: NostrEvent): string | null {
  try {
    return bytesToHex(getKeyPackage(event).leafNode.signaturePublicKey);
  } catch {
    return null;
  }
}

const MAX_CLIENT_NAME = 40;

/** The app that published an invitation key (its `client` tag), or null. */
export function keyPackageClient(event: Pick<NostrEvent, 'tags'>): string | null {
  const name = event.tags.find((t) => t[0] === 'client')?.[1]?.trim();
  return name ? name.slice(0, MAX_CLIENT_NAME) : null;
}

// --- Device changes (alpha-only notices) ------------------------------------

/** What we last saw of one leaf. */
export interface LeafRecord {
  pubkey: string;
  /** The epoch we first saw it in. */
  firstEpoch: number;
  /** It was already there the first time we looked at the group (when we
   * created or joined it), so `firstEpoch` is when WE arrived, not it. */
  baseline: boolean;
}

/** The leaves of a group as of one epoch, keyed by leaf signature key. */
export interface LeafSnapshot {
  epoch: number;
  leaves: Record<string, LeafRecord>;
}

/** One person's devices that appeared in a commit. */
export interface DeviceAddition {
  pubkey: string;
  /** They weren't in the chat before (vs. adding a device to it). */
  joined: boolean;
  /** The new leaves' signature keys. */
  keys: string[];
}

/**
 * Compare the tree after a commit with the last snapshot. The first look at a
 * group is a baseline (nothing is "added" — that's the state we created or
 * joined). A snapshot from a later-or-equal epoch (a fork rewind) re-baselines
 * silently rather than inventing changes. Removed leaves just drop out.
 */
export function diffLeaves(
  prev: LeafSnapshot | null,
  leaves: readonly GroupLeaf[],
  epoch: number,
): { snapshot: LeafSnapshot; added: DeviceAddition[] } {
  const next: LeafSnapshot = { epoch, leaves: {} };
  if (!prev || epoch <= prev.epoch) {
    for (const l of leaves) {
      next.leaves[l.key] = prev?.leaves[l.key] ?? {
        pubkey: l.pubkey,
        firstEpoch: epoch,
        baseline: !prev,
      };
    }
    return { snapshot: next, added: [] };
  }
  const before = new Set(Object.values(prev.leaves).map((r) => r.pubkey));
  const added = new Map<string, DeviceAddition>();
  for (const l of leaves) {
    const seen = prev.leaves[l.key];
    if (seen) {
      next.leaves[l.key] = seen;
      continue;
    }
    next.leaves[l.key] = { pubkey: l.pubkey, firstEpoch: epoch, baseline: false };
    const entry = added.get(l.pubkey) ?? {
      pubkey: l.pubkey,
      joined: !before.has(l.pubkey),
      keys: [],
    };
    entry.keys.push(l.key);
    added.set(l.pubkey, entry);
  }
  return { snapshot: next, added: [...added.values()] };
}
