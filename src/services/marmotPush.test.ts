import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { Buffer } from 'buffer';
import { generateSecretKey, getPublicKey, nip59 } from 'nostr-tools';

import {
  applyPushPayload,
  buildTriggerWraps,
  leafKey,
  ownerProofEventId,
  pruneToLeaves,
  selectTriggerTargets,
  signedRecordDigest,
  verifyOwnerSig,
  type PushRecord,
} from './marmotPush';

// Spec fixture ("Removal signing test vector"): BIP-340 secret key 3.
const VECTOR = {
  member: 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
  leaf: 3,
  platform: 'apns' as const,
  server: '2f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
  fingerprint: 'sha256:000102030405060708090a0b',
  ownerTs: 1700000000000,
  ownerSig:
    '04c3588a6533399aeaebb6c596fab896186dd0af1f9724f2926d984d2876490c76e1d149127e0fa697d7f19a0807aa373e942f0eb33edc63071567f274ce3bec',
};
const VECTOR_GROUP = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

describe('MIP-05 owner proof', () => {
  it('reproduces the spec removal-signing vector byte for byte', () => {
    expect(ownerProofEventId(VECTOR, VECTOR_GROUP)).toBe(
      'be12f4d029d3cac4034251949d6c013ff18eae00870e199012c7a97e8960b7a2',
    );
    expect(verifyOwnerSig(VECTOR, VECTOR_GROUP)).toBe(true);
    expect(verifyOwnerSig({ ...VECTOR, leaf: 4 }, VECTOR_GROUP)).toBe(false);
    expect(verifyOwnerSig(VECTOR, VECTOR_GROUP.replace(/^00/, '01'))).toBe(false);
  });
});

// A real member: signs records the way a White Noise client would.
const GROUP_HEX = 'ab'.repeat(16);
const GROUP = { idHex: GROUP_HEX, id: hexToBytes(GROUP_HEX) };
function member() {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
}
function signedRecord(
  who: { sk: Uint8Array; pk: string },
  over: Partial<PushRecord> = {},
): Record<string, unknown> {
  const base: PushRecord = {
    member: who.pk,
    leaf: 1,
    platform: 'fcm',
    fingerprint: 'sha256:' + 'cd'.repeat(12),
    server: 'ee'.repeat(32),
    relayHint: 'wss://relay.eu.whitenoise.chat',
    encryptedToken: Buffer.alloc(1084, over.ownerTs ? over.ownerTs % 251 : 7).toString('base64'),
    ownerTs: 1_700_000_000_000,
    ownerSig: '',
    ...over,
  };
  const sig = bytesToHex(schnorr.sign(hexToBytes(ownerProofEventId(base, GROUP_HEX)), who.sk));
  return {
    member_id_hex: base.member,
    leaf_index: base.leaf,
    platform: base.platform,
    token_fingerprint: base.fingerprint,
    server_pubkey_hex: base.server,
    relay_hint: base.relayHint,
    encrypted_token: base.encryptedToken,
    owner_ts: base.ownerTs,
    owner_sig: sig,
  };
}
const payload = (field: 'tokens' | 'removals', entries: unknown[]) =>
  JSON.stringify({ v: 'marmot-push-v1', [field]: entries });
const NOW = 1_700_000_100_000;

describe('MIP-05 record state', () => {
  const alice = member();
  const bob = member();
  const leaves = new Set([leafKey(alice.pk, 1), leafKey(bob.pk, 1)]);

  it('applies a signed record for a current leaf, and drops forged / non-member / far-future ones', async () => {
    const good = signedRecord(bob);
    const forged = { ...signedRecord(bob), server_pubkey_hex: 'dd'.repeat(32) }; // repointed after signing
    const stranger = signedRecord(member());
    const future = signedRecord(bob, { ownerTs: NOW + 3_600_001 });
    const state = await applyPushPayload(
      {},
      448,
      payload('tokens', [good, forged, stranger, future]),
      { ...GROUP, leaves },
      NOW,
    );
    const records = Object.values(state).map((s) => s.record);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ member: bob.pk, server: 'ee'.repeat(32) });
  });

  it('ignores the whole array past 32 entries, and any other version', async () => {
    const many = Array.from({ length: 33 }, () => signedRecord(bob));
    expect(
      await applyPushPayload({}, 448, payload('tokens', many), { ...GROUP, leaves }, NOW),
    ).toEqual({});
    const v2 = JSON.stringify({ v: 'marmot-push-v2', tokens: [signedRecord(bob)] });
    expect(await applyPushPayload({}, 447, v2, { ...GROUP, leaves }, NOW)).toEqual({});
  });

  it('latest owner_ts wins; a removal tombstones the key so an older relayed record cannot resurrect it', async () => {
    const g = { ...GROUP, leaves };
    let state = await applyPushPayload(
      {},
      447,
      payload('tokens', [signedRecord(bob, { ownerTs: 1_000 })]),
      g,
      NOW,
    );
    state = await applyPushPayload(
      state,
      447,
      payload('tokens', [signedRecord(bob, { ownerTs: 2_000 })]),
      g,
      NOW,
    );
    expect(Object.values(state)[0].record?.ownerTs).toBe(2_000);
    // Removal at ts 3000 (removal entries omit relay_hint / encrypted_token).
    const rm: PushRecord = { ...(Object.values(state)[0].record as PushRecord), ownerTs: 3_000 };
    const removal = {
      member_id_hex: rm.member, leaf_index: rm.leaf, platform: rm.platform,
      token_fingerprint: rm.fingerprint, server_pubkey_hex: rm.server, owner_ts: rm.ownerTs,
      owner_sig: bytesToHex(schnorr.sign(hexToBytes(ownerProofEventId(
        { member: rm.member, leaf: rm.leaf, platform: rm.platform, fingerprint: rm.fingerprint,
          server: rm.server, ownerTs: rm.ownerTs, ownerSig: '' }, GROUP_HEX)), bob.sk)),
    }; // prettier-ignore
    state = await applyPushPayload(state, 449, payload('removals', [removal]), g, NOW);
    expect(Object.values(state)[0].record).toBeNull();
    // A stale list response (ts 2500) loses to the tombstone…
    state = await applyPushPayload(
      state,
      448,
      payload('tokens', [signedRecord(bob, { ownerTs: 2_500 })]),
      g,
      NOW,
    );
    expect(Object.values(state)[0].record).toBeNull();
    // …a newer self-update re-establishes it.
    state = await applyPushPayload(
      state,
      447,
      payload('tokens', [signedRecord(bob, { ownerTs: 4_000 })]),
      g,
      NOW,
    );
    expect(Object.values(state)[0].record?.ownerTs).toBe(4_000);
  });

  it('digest tie-breaks equal owner_ts deterministically', () => {
    const a = { member: bob.pk, leaf: 1, platform: 'fcm' as const, fingerprint: 'sha256:' + '00'.repeat(12),
      server: 'ee'.repeat(32), ownerTs: 5, ownerSig: '' }; // prettier-ignore
    expect(signedRecordDigest(a, GROUP.id)).toMatch(/^[0-9a-f]{64}$/);
    expect(signedRecordDigest(a, GROUP.id)).not.toBe(
      signedRecordDigest({ ...a, leaf: 2 }, GROUP.id),
    );
  });

  it('wakes every other member, never our own devices, and forgets leaves that left', async () => {
    const g = { ...GROUP, leaves };
    let state = await applyPushPayload(
      {},
      448,
      payload('tokens', [signedRecord(alice), signedRecord(bob)]),
      g,
      NOW,
    );
    expect(selectTriggerTargets(state, alice.pk, leaves)).toEqual([
      {
        server: 'ee'.repeat(32),
        relayHints: ['wss://relay.eu.whitenoise.chat'],
        tokens: [expect.any(String)],
      },
    ]);
    state = pruneToLeaves(state, new Set([leafKey(alice.pk, 1)]));
    expect(selectTriggerTargets(state, alice.pk, new Set([leafKey(alice.pk, 1)]))).toEqual([]);
  });
});

describe('MIP-05 trigger (kind 446)', () => {
  it('gift-wraps the encrypted tokens to the server: rumor and seal share one ephemeral key, only the v tag', () => {
    const server = member();
    const tokens = Array.from({ length: 20 }, (_, i) => Buffer.alloc(1084, i).toString('base64'));
    const wraps = [...buildTriggerWraps(server.pk, tokens)];
    expect(wraps).toHaveLength(2); // 19 + 1, like MDK
    const rumor = nip59.unwrapEvent(wraps[0], server.sk);
    expect(rumor.kind).toBe(446);
    expect(rumor.tags).toEqual([['v', 'marmot-push-v1']]);
    expect(Buffer.from(rumor.content, 'base64')).toHaveLength(19 * 1084);
    expect(wraps[0].kind).toBe(1059);
    expect(wraps[0].tags).toEqual([['p', server.pk]]);
  });
});

describe('MIP-05 strict decoding (review fixes)', () => {
  const bob = member();
  const leaves = new Set([leafKey(bob.pk, 1)]);
  it('rejects non-canonical base64 (non-zero padding bits) even when owner-signed', async () => {
    const canonical = Buffer.alloc(1084, 0).toString('base64'); // ends "AA=="
    const sloppy = canonical.slice(0, -3) + 'B=='; // decodes to the same bytes
    expect(Buffer.from(sloppy, 'base64').equals(Buffer.from(canonical, 'base64'))).toBe(true);
    const entry = signedRecord(bob, { encryptedToken: sloppy });
    expect(
      await applyPushPayload({}, 447, payload('tokens', [entry]), { ...GROUP, leaves }, NOW),
    ).toEqual({});
  });
  it("rejects a relay hint too long for SignedRecord's u16 length", async () => {
    const entry = signedRecord(bob, { relayHint: 'wss://' + 'a'.repeat(70_000) });
    expect(
      await applyPushPayload({}, 447, payload('tokens', [entry]), { ...GROUP, leaves }, NOW),
    ).toEqual({});
  });
});
