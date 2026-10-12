import {
  createCredential,
  encodeAuthorizationProof,
  makeLeafAppComponentsExtension,
} from '@internet-privacy/marmot-ts';
import { defaultCredentialTypes, nodeTypes } from '@internet-privacy/marmot-ts/mls';
import { bytesToHex } from '@noble/hashes/utils.js';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

import {
  deviceCounts,
  diffLeaves,
  keyPackageClient,
  leafKeyCreatedAt,
  leavesByPerson,
  readGroupLeaves,
  type GroupLeaf,
} from './marmotDevices';

const person = () => getPublicKey(generateSecretKey());
const sigKey = (n: number) => new Uint8Array(32).fill(n);

function proofExtension(createdAt: number) {
  const proof = encodeAuthorizationProof({
    signerPubkey: new Uint8Array(32).fill(7),
    createdAt,
    signature: new Uint8Array(64).fill(9),
  });
  return makeLeafAppComponentsExtension(proof);
}

type Slot = { pubkey: string; key: number; createdAt?: number } | null | 'bad';

/** A ratchet tree with one leaf per slot (parents in between, as in MLS). */
function tree(slots: Slot[], ownLeaf?: number) {
  const ratchetTree: unknown[] = [];
  slots.forEach((slot, i) => {
    if (i > 0) ratchetTree.push({ nodeType: nodeTypes.parent, parent: {} });
    if (slot === null) ratchetTree.push(undefined);
    else if (slot === 'bad') {
      ratchetTree.push({
        nodeType: nodeTypes.leaf,
        leaf: {
          credential: { credentialType: defaultCredentialTypes.basic, identity: new Uint8Array(3) },
          signaturePublicKey: sigKey(99),
          extensions: [],
        },
      });
    } else {
      ratchetTree.push({
        nodeType: nodeTypes.leaf,
        leaf: {
          credential: createCredential(slot.pubkey),
          signaturePublicKey: sigKey(slot.key),
          extensions: slot.createdAt ? [proofExtension(slot.createdAt)] : [],
        },
      });
    }
  });
  return {
    ratchetTree,
    ...(ownLeaf === undefined ? {} : { privatePath: { leafIndex: ownLeaf } }),
  } as unknown as Parameters<typeof readGroupLeaves>[0];
}

describe('readGroupLeaves', () => {
  const [me, peer] = [person(), person()];

  it('reads one leaf per device with its key, index, proof time and owner', () => {
    const leaves = readGroupLeaves(
      tree(
        [
          { pubkey: me, key: 1, createdAt: 1_700_000_000 },
          { pubkey: peer, key: 2, createdAt: 1_700_000_100 },
          { pubkey: peer, key: 3 },
        ],
        0,
      ),
    );
    expect(leaves).toEqual([
      {
        pubkey: me,
        leafIndex: 0,
        key: bytesToHex(sigKey(1)),
        keyCreatedAt: 1_700_000_000,
        isOwn: true,
      },
      {
        pubkey: peer,
        leafIndex: 1,
        key: bytesToHex(sigKey(2)),
        keyCreatedAt: 1_700_000_100,
        isOwn: false,
      },
      { pubkey: peer, leafIndex: 2, key: bytesToHex(sigKey(3)), keyCreatedAt: null, isOwn: false },
    ]);
  });

  it('skips blank slots (a removed device) and leaves that are not a valid account', () => {
    const leaves = readGroupLeaves(
      tree([{ pubkey: me, key: 1 }, null, 'bad', { pubkey: peer, key: 4 }], 0),
    );
    expect(leaves.map((l) => [l.pubkey, l.leafIndex])).toEqual([
      [me, 0],
      [peer, 3],
    ]);
  });

  it('marks no leaf as ours when the state has no private path', () => {
    expect(readGroupLeaves(tree([{ pubkey: me, key: 1 }])).some((l) => l.isOwn)).toBe(false);
  });
});

describe('grouping devices by person', () => {
  const [me, peer] = [person(), person()];
  const leaves = readGroupLeaves(
    tree(
      [
        { pubkey: peer, key: 1 },
        { pubkey: me, key: 2 },
        { pubkey: peer, key: 3 },
      ],
      1,
    ),
  );

  it('groups leaves by credential, keeping each person’s leaf order', () => {
    const byPerson = leavesByPerson(leaves);
    expect([...byPerson.keys()]).toEqual([peer, me]);
    expect(byPerson.get(peer)?.map((l) => l.leafIndex)).toEqual([0, 2]);
  });

  it('counts devices per person (one device = 1)', () => {
    expect(deviceCounts(leaves)).toEqual(
      new Map([
        [peer, 2],
        [me, 1],
      ]),
    );
  });
});

describe('leafKeyCreatedAt', () => {
  it('is null for a leaf without a proof or with a garbled dictionary', () => {
    expect(leafKeyCreatedAt({ extensions: [] })).toBeNull();
    expect(
      leafKeyCreatedAt({
        extensions: [{ extensionType: 0x0006, extensionData: new Uint8Array([1, 2]) }],
      } as never),
    ).toBeNull();
  });
});

describe('keyPackageClient', () => {
  it('reads the client tag, trimmed and capped', () => {
    expect(keyPackageClient({ tags: [['client', ' White Noise ']] })).toBe('White Noise');
    expect(keyPackageClient({ tags: [['client', 'x'.repeat(80)]] })).toHaveLength(40);
    expect(keyPackageClient({ tags: [['d', 'slot']] })).toBeNull();
    expect(keyPackageClient({ tags: [['client', '  ']] })).toBeNull();
  });
});

describe('diffLeaves', () => {
  const [me, peer, third] = [person(), person(), person()];
  // When this phone processed each epoch's commit (unix seconds).
  const at = (epoch: number) => 1_800_000_000 + epoch * 60;
  const leaf = (pubkey: string, key: string): GroupLeaf => ({
    pubkey,
    key,
    leafIndex: 0,
    keyCreatedAt: null,
    isOwn: false,
  });

  it('baselines the first look: nothing added, every leaf marked as already there', () => {
    const { snapshot, added } = diffLeaves(null, [leaf(me, 'a'), leaf(peer, 'b')], 1, at(1));
    expect(added).toEqual([]);
    expect(snapshot).toEqual({
      epoch: 1,
      leaves: {
        a: { pubkey: me, firstEpoch: 1, baseline: true },
        b: { pubkey: peer, firstEpoch: 1, baseline: true },
      },
    });
  });

  it('reports a person joining on several devices as one addition, with when it was seen', () => {
    const base = diffLeaves(null, [leaf(me, 'a')], 0, at(0)).snapshot;
    const { snapshot, added } = diffLeaves(
      base,
      [leaf(me, 'a'), leaf(peer, 'b'), leaf(peer, 'c')],
      1,
      at(1),
    );
    expect(added).toEqual([{ pubkey: peer, joined: true, keys: ['b', 'c'] }]);
    expect(snapshot.leaves.b).toEqual({
      pubkey: peer,
      firstEpoch: 1,
      baseline: false,
      seenAt: at(1),
    });
    expect(snapshot.leaves.a).toEqual(base.leaves.a);
  });

  it('reports a new device of someone already here as "added", not "joined"', () => {
    const base = diffLeaves(null, [leaf(me, 'a'), leaf(peer, 'b')], 3, at(3)).snapshot;
    const { added } = diffLeaves(base, [leaf(me, 'a'), leaf(peer, 'b'), leaf(peer, 'c')], 4, at(4));
    expect(added).toEqual([{ pubkey: peer, joined: false, keys: ['c'] }]);
  });

  it('drops a removed device, reports nothing for it, and notes when its person lost it', () => {
    const base = diffLeaves(
      null,
      [leaf(me, 'a'), leaf(peer, 'b'), leaf(peer, 'c')],
      3,
      at(3),
    ).snapshot;
    const { snapshot, added } = diffLeaves(base, [leaf(me, 'a'), leaf(peer, 'b')], 4, at(4));
    expect(added).toEqual([]);
    expect(Object.keys(snapshot.leaves)).toEqual(['a', 'b']);
    expect(snapshot.removedAt).toEqual({ [peer]: at(4) });
    // Kept across later commits.
    expect(
      diffLeaves(snapshot, [leaf(me, 'a'), leaf(peer, 'b')], 5, at(5)).snapshot.removedAt,
    ).toEqual({ [peer]: at(4) });
  });

  it('a removed person who comes back later "joins" again', () => {
    const base = diffLeaves(null, [leaf(me, 'a'), leaf(peer, 'b')], 3, at(3)).snapshot;
    const gone = diffLeaves(base, [leaf(me, 'a')], 4, at(4)).snapshot;
    expect(diffLeaves(gone, [leaf(me, 'a'), leaf(peer, 'z')], 5, at(5)).added).toEqual([
      { pubkey: peer, joined: true, keys: ['z'] },
    ]);
  });

  it('re-baselines silently on an older-or-equal epoch (a fork rewind)', () => {
    const base = diffLeaves(null, [leaf(me, 'a')], 5, at(5)).snapshot;
    const { snapshot, added } = diffLeaves(base, [leaf(me, 'a'), leaf(third, 't')], 5, at(6));
    expect(added).toEqual([]);
    expect(snapshot.leaves.t).toEqual({
      pubkey: third,
      firstEpoch: 5,
      baseline: false,
      seenAt: at(6),
    });
  });
});
